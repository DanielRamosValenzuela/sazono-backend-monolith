import {
  MAX_LIMITER_WAIT_MS,
  RateLimitWaitTooLongError,
  RequestRateLimiter,
} from './rate-limiter';

function fakeClock() {
  const state = { now: 1_000_000, slept: [] as number[] };

  return {
    state,
    clock: {
      now: () => state.now,
      sleep: (ms: number) => {
        state.slept.push(ms);
        state.now += ms;
        return Promise.resolve();
      },
    },
  };
}

describe('RequestRateLimiter', () => {
  it('lets three requests through per second and delays the fourth', async () => {
    const { state, clock } = fakeClock();
    const limiter = new RequestRateLimiter(3, 100, clock);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(state.slept).toEqual([]);

    await limiter.acquire();
    expect(state.slept).toHaveLength(1);
    expect(state.slept[0]).toBeGreaterThanOrEqual(1000);
  });

  it('enforces the per minute budget', async () => {
    const { state, clock } = fakeClock();
    const limiter = new RequestRateLimiter(1000, 5, clock);

    for (let i = 0; i < 5; i += 1) {
      await limiter.acquire();
    }

    state.now += 40_000;
    await limiter.acquire();
    expect(state.slept[0]).toBeGreaterThanOrEqual(20_000);
  });

  it('gives up instead of blocking for too long', async () => {
    const { state, clock } = fakeClock();
    const limiter = new RequestRateLimiter(1000, 1, clock);

    await limiter.acquire();
    state.now += 1;

    await expect(limiter.acquire()).rejects.toBeInstanceOf(
      RateLimitWaitTooLongError,
    );
    expect(MAX_LIMITER_WAIT_MS).toBe(30_000);
  });
});
