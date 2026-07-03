import { TableSessionStatus } from '@prisma/client';

export const ACTIVE_TABLE_SESSION_STATUSES: TableSessionStatus[] = [
  TableSessionStatus.OPEN,
  TableSessionStatus.PAYMENT_COMPLETED,
];
