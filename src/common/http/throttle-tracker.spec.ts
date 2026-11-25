import { throttleTracker } from './throttle-tracker';

const token = 'a'.repeat(43);

describe('throttleTracker', () => {
  it('keys device requests by token hash so devices behind one proxy do not share a bucket', () => {
    const a = throttleTracker({
      ip: '10.0.0.1',
      headers: { authorization: `Device ${token}` },
    });
    const b = throttleTracker({
      ip: '10.0.0.1',
      headers: { authorization: `Device ${'b'.repeat(43)}` },
    });

    expect(a).toMatch(/^device:[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(token);
  });

  it('falls back to the ip for pairing and every other route', () => {
    expect(throttleTracker({ ip: '1.2.3.4', headers: {} })).toBe('1.2.3.4');
    expect(
      throttleTracker({
        ip: '1.2.3.4',
        headers: { authorization: 'Bearer xyz' },
      }),
    ).toBe('1.2.3.4');
    expect(throttleTracker({})).toBe('unknown');
  });
});
