import { Role } from '@prisma/client';

export const FLOOR_ASSIGN_ROLES: Role[] = [
  Role.ADMIN,
  Role.SUPERVISOR,
  Role.WAITER,
  Role.CASHIER,
];

export const FLOOR_REASSIGN_ANYONE_ROLES: Role[] = [
  Role.ADMIN,
  Role.SUPERVISOR,
];
