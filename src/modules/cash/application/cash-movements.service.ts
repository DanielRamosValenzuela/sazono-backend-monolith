import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CashMovementType, Prisma, Role } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { signedMovementAmount } from '../domain/cash-expected';
import type {
  CreateCashAdjustmentDto,
  CreateCashMovementDto,
  ListCashMovementsQueryDto,
} from '../presentation/http/dto/cash.dto';
import { findOpenCashSessionId } from '../../payments/application/find-open-cash-session';
import type { CashRequestMeta } from './cash-sessions.service';

const MOVEMENT_SELECT = {
  id: true,
  type: true,
  amount: true,
  reason: true,
  cashSessionId: true,
  staffUserId: true,
  createdAt: true,
  staffUser: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CashMovementSelect;

type MovementRecord = Prisma.CashMovementGetPayload<{
  select: typeof MOVEMENT_SELECT;
}>;

export type CashMovementDto = {
  id: string;
  type: CashMovementType;
  amount: string;
  reason: string;
  cashSessionId: string | null;
  staffUserId: string;
  staffName: string | null;
  createdAt: string;
};

function toDto(record: MovementRecord): CashMovementDto {
  return {
    id: record.id,
    type: record.type,
    amount: record.amount.toFixed(0),
    reason: record.reason,
    cashSessionId: record.cashSessionId,
    staffUserId: record.staffUserId,
    staffName:
      `${record.staffUser.firstName ?? ''} ${record.staffUser.lastName ?? ''}`.trim() ||
      null,
    createdAt: record.createdAt.toISOString(),
  };
}

@Injectable()
export class CashMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    authUser: JwtPayload,
    branchId: string,
    idempotencyKey: string,
    dto: CreateCashMovementDto,
    meta: CashRequestMeta,
  ): Promise<CashMovementDto> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.CASHIER],
      { fresh: true },
    );
    const type = dto.type as CashMovementType;
    const amount = signedMovementAmount(type, new Prisma.Decimal(dto.amount));

    return this.record(
      context,
      branchId,
      idempotencyKey,
      type,
      amount,
      dto.reason.trim(),
      undefined,
      meta,
      'CASH_MOVEMENT_CREATED',
    );
  }

  async createAdjustment(
    authUser: JwtPayload,
    branchId: string,
    idempotencyKey: string,
    dto: CreateCashAdjustmentDto,
    meta: CashRequestMeta,
  ): Promise<CashMovementDto> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN],
      { fresh: true },
    );

    return this.record(
      context,
      branchId,
      idempotencyKey,
      CashMovementType.ADJUSTMENT,
      new Prisma.Decimal(dto.amount),
      dto.reason.trim(),
      dto.cashSessionId,
      meta,
      'CASH_ADJUSTMENT_CREATED',
    );
  }

  async list(
    authUser: JwtPayload,
    branchId: string,
    query: ListCashMovementsQueryDto,
  ): Promise<{ movements: CashMovementDto[] }> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );
    const isManager =
      context.roles.includes(Role.ADMIN) ||
      context.roles.includes(Role.SUPERVISOR);
    const records = await this.prisma.cashMovement.findMany({
      where: {
        branchId,
        ...(isManager ? {} : { staffUserId: context.staffUserId }),
        ...(query.type ? { type: query.type } : {}),
        ...(query.cashSessionId ? { cashSessionId: query.cashSessionId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lt: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      select: MOVEMENT_SELECT,
    });

    return { movements: records.map(toDto) };
  }

  private async record(
    context: { staffUserId: string; restaurantId: string; roles: Role[] },
    branchId: string,
    idempotencyKey: string,
    type: CashMovementType,
    amount: Prisma.Decimal,
    reason: string,
    explicitSessionId: string | undefined,
    meta: CashRequestMeta,
    action: string,
  ): Promise<CashMovementDto> {
    const replay = () =>
      this.replay(
        branchId,
        context.staffUserId,
        idempotencyKey,
        type,
        amount,
        reason,
        explicitSessionId,
      );
    const existing = await replay();

    if (existing) {
      return existing;
    }

    const hadSession =
      !explicitSessionId &&
      (await this.prisma.cashSession.findFirst({
        where: {
          branchId,
          cashierStaffUserId: context.staffUserId,
          status: 'OPEN',
        },
        select: { id: true },
      })) !== null;

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const sessionId = await this.resolveSession(
          tx,
          branchId,
          context.staffUserId,
          explicitSessionId,
          hadSession,
        );

        const movement = await tx.cashMovement.create({
          data: {
            branchId,
            type,
            amount,
            reason,
            cashSessionId: sessionId,
            idempotencyKey,
            staffUserId: context.staffUserId,
          },
          select: MOVEMENT_SELECT,
        });

        await this.auditService.record(tx, {
          restaurantId: context.restaurantId,
          branchId,
          actorStaffUserId: context.staffUserId,
          actorRole: context.roles.includes(Role.ADMIN)
            ? Role.ADMIN
            : Role.CASHIER,
          action,
          entityType: 'CashMovement',
          entityId: movement.id,
          after: {
            type,
            amount: amount.toString(),
            cashSessionId: sessionId,
            idempotencyKey,
          },
          reason,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return movement;
      });

      return toDto(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await replay();

        if (raced) {
          return raced;
        }
      }

      throw error;
    }
  }

  private async resolveSession(
    tx: Prisma.TransactionClient,
    branchId: string,
    staffUserId: string,
    explicitSessionId: string | undefined,
    hadSession: boolean,
  ): Promise<string | null> {
    if (explicitSessionId) {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id::text AS id FROM cash_sessions WHERE id = ${explicitSessionId}::uuid AND branch_id = ${branchId}::uuid AND status = 'OPEN' FOR SHARE`,
      );

      if (locked.length > 0) {
        return locked[0].id;
      }

      const session = await tx.cashSession.findFirst({
        where: { id: explicitSessionId, branchId },
        select: { id: true },
      });

      if (!session) {
        throw new NotFoundException({
          message: 'La sesion de caja no existe.',
          code: 'CASH_SESSION_NOT_FOUND',
        });
      }

      throw new ConflictException({
        message: 'La sesion de caja ya esta cerrada.',
        code: 'CASH_SESSION_ALREADY_CLOSED',
      });
    }

    const own = await findOpenCashSessionId(tx, branchId, staffUserId);

    if (own) {
      return own;
    }

    if (hadSession) {
      throw new ConflictException({
        message: 'La sesion de caja ya esta cerrada.',
        code: 'CASH_SESSION_ALREADY_CLOSED',
      });
    }

    const settings = await tx.branchSettings.findUnique({
      where: { branchId },
      select: { requireOpenCashSession: true },
    });

    if (settings?.requireOpenCashSession) {
      throw new ConflictException({
        message: 'Debes abrir tu caja antes de registrar movimientos.',
        code: 'CASH_SESSION_REQUIRED',
      });
    }

    return null;
  }

  private async replay(
    branchId: string,
    staffUserId: string,
    idempotencyKey: string,
    type: CashMovementType,
    amount: Prisma.Decimal,
    reason: string,
    explicitSessionId: string | undefined,
  ): Promise<CashMovementDto | null> {
    const existing = await this.prisma.cashMovement.findFirst({
      where: { branchId, staffUserId, idempotencyKey },
      select: MOVEMENT_SELECT,
    });

    if (!existing) {
      return null;
    }

    if (
      existing.type !== type ||
      !existing.amount.equals(amount) ||
      existing.reason !== reason ||
      (explicitSessionId !== undefined &&
        existing.cashSessionId !== explicitSessionId)
    ) {
      throw new ConflictException({
        message: 'La Idempotency-Key ya se uso con otro movimiento.',
        code: 'CASH_IDEMPOTENCY_KEY_REUSED',
      });
    }

    return toDto(existing);
  }
}
