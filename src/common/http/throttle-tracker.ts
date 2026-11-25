import { createHash } from 'node:crypto';

type TrackedRequest = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
};

const DEVICE_AUTHORIZATION = /^Device\s+(\S{20,200})$/;

export function throttleTracker(req: TrackedRequest): string {
  const header = req.headers?.authorization;
  const token =
    typeof header === 'string'
      ? DEVICE_AUTHORIZATION.exec(header.trim())?.[1]
      : undefined;

  return token
    ? `device:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`
    : (req.ip ?? 'unknown');
}
