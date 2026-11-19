export const MAX_REQUESTS_PER_SECOND = 3;
export const MAX_REQUESTS_PER_MINUTE = 100;
export const MAX_LIMITER_WAIT_MS = 30_000;

export class RateLimitWaitTooLongError extends Error {
  constructor(readonly waitMs: number) {
    super(
      'Limite de solicitudes al proveedor alcanzado, se reintentara luego.',
    );
  }
}

export type LimiterClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const realClock: LimiterClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class RequestRateLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly perSecond = MAX_REQUESTS_PER_SECOND,
    private readonly perMinute = MAX_REQUESTS_PER_MINUTE,
    private readonly clock: LimiterClock = realClock,
  ) {}

  private waitNeeded(now: number): number {
    const lastSecond = this.stamps.filter((stamp) => stamp > now - 1000);
    const lastMinute = this.stamps.filter((stamp) => stamp > now - 60_000);
    let wait = 0;

    if (lastSecond.length >= this.perSecond) {
      wait = Math.max(wait, lastSecond[0] + 1000 - now);
    }

    if (lastMinute.length >= this.perMinute) {
      wait = Math.max(wait, lastMinute[0] + 60_000 - now);
    }

    return wait;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.clock.now();

      while (this.stamps.length > 0 && this.stamps[0] <= now - 60_000) {
        this.stamps.shift();
      }

      const wait = this.waitNeeded(now);

      if (wait <= 0) {
        this.stamps.push(now);
        return;
      }

      if (wait > MAX_LIMITER_WAIT_MS) {
        throw new RateLimitWaitTooLongError(wait);
      }

      await this.clock.sleep(wait + 5);
    }
  }
}
