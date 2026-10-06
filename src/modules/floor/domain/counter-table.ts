import { Role } from '@prisma/client';

export const COUNTER_TABLE_CODE = 'MOSTRADOR';
export const COUNTER_TABLE_NAME = 'Mesa virtual';
export const COUNTER_TICKET_MAX = 999;
export const COUNTER_CUSTOMER_LABEL_MAX = 40;
export const COUNTER_SESSION_ROLES: Role[] = [
  Role.ADMIN,
  Role.SUPERVISOR,
  Role.WAITER,
  Role.CASHIER,
];

export const COUNTER_STALE_MAX_AGE_HOURS = 12;
export const COUNTER_STALE_AUTO_ABANDON_REASON = 'auto-expired';
export const COUNTER_STALE_SWEEP_INTERVAL_MS = 15 * 60_000;
