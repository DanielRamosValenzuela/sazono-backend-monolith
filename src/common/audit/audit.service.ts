import { Injectable } from '@nestjs/common';
import type { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuditRecordInput = {
  restaurantId: string | null;
  branchId: string | null;
  actorStaffUserId: string | null;
  actorPlatformAdminId?: string | null;
  actorRole: Role | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

const MAX_IP_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 300;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    client: AuditClient | null,
    input: AuditRecordInput,
  ): Promise<void> {
    await (client ?? this.prisma).auditLog.create({
      data: {
        restaurantId: input.restaurantId,
        branchId: input.branchId,
        actorStaffUserId: input.actorStaffUserId,
        actorPlatformAdminId: input.actorPlatformAdminId ?? null,
        actorRole: input.actorRole,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before,
        after: input.after,
        reason: input.reason ?? null,
        ip: input.ip ? input.ip.slice(0, MAX_IP_LENGTH) : null,
        userAgent: input.userAgent
          ? input.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
          : null,
      },
    });
  }
}
