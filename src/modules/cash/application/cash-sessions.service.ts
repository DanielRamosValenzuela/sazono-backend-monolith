import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillStatus,
  CashSessionStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  computeDifference,
  computeSessionFigures,
  normalizeRegisterLabel,
  type CashSessionFigures,
} from '../domain/cash-expected';
import type {
  CloseCashSessionDto,
  ListCashSessionsQueryDto,
  OpenCashSessionDto,
} from '../presentation/http/dto/cash.dto';

export type CashRequestMeta = { ip: string | null; userAgent: string | null };

const OPEN_BILL_STATUSES: BillStatus[] = [
  BillStatus.OPEN,
  BillStatus.PARTIALLY_PAID,
];
const MANAGER_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR];
const SESSION_INCLUDE = {
  cashier: { select: { firstName: true, lastName: true } },
  closedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.CashSessionInclude;

type SessionRecord = Prisma.CashSessionGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

const personName = (
  person: { firstName: string | null; lastName: string | null } | null,
) =>
  person
    ? `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() || null
    : null;

const str = (value: Prisma.Decimal | null) =>
  value === null ? null : value.toFixed(0);

export type CashSessionDto = {
  id: string;
  branchId: string;
  registerLabel: string;
  status: CashSessionStatus;
  cashierStaffUserId: string;
  cashierName: string | null;
  openedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  forced: boolean;
  openingFloat: string;
  cashSalesAmount: string;
  cashInAmount: string;
  cashOutAmount: string;
  refundOutAmount: string;
  otherMovementsAmount: string;
  movementsAmount: string;
  expectedCash: string;
  countedCash: string | null;
  difference: string | null;
  closingNote: string | null;
  denominations: Prisma.JsonValue | null;
};

export type CashSessionWarnings = {
  openBills: number;
  partialBillsCollectedInSession: number;
};

@Injectable()
export class CashSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly auditService: AuditService,
  ) {}

  async open(
    authUser: JwtPayload,
    branchId: string,
    dto: OpenCashSessionDto,
    meta: CashRequestMeta,
  ): Promise<CashSessionDto> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.CASHIER],
      { fresh: true },
    );
    const label = normalizeRegisterLabel(dto.registerLabel);
    const openingFloat = new Prisma.Decimal(dto.openingFloat);

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const created = await tx.cashSession.create({
          data: {
            restaurantId: context.restaurantId,
            branchId,
            registerLabel: label,
            cashierStaffUserId: context.staffUserId,
            openingFloat,
          },
          include: SESSION_INCLUDE,
        });

        await this.auditService.record(tx, {
          restaurantId: context.restaurantId,
          branchId,
          actorStaffUserId: context.staffUserId,
          actorRole: context.roles.includes(Role.ADMIN)
            ? Role.ADMIN
            : Role.CASHIER,
          action: 'CASH_SESSION_OPENED',
          entityType: 'CashSession',
          entityId: created.id,
          after: {
            registerLabel: label,
            openingFloat: openingFloat.toString(),
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return created;
      });

      return this.toDto(session, computeSessionFigures(openingFloat, 0, []));
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      return this.resolveOpenConflict(
        branchId,
        context.staffUserId,
        label,
        openingFloat,
      );
    }
  }

  async current(
    authUser: JwtPayload,
    branchId: string,
  ): Promise<{ session: CashSessionDto | null }> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );
    const session = await this.prisma.cashSession.findFirst({
      where: {
        branchId,
        cashierStaffUserId: context.staffUserId,
        status: CashSessionStatus.OPEN,
      },
      include: SESSION_INCLUDE,
    });

    return { session: session ? await this.withLiveFigures(session) : null };
  }

  async list(
    authUser: JwtPayload,
    branchId: string,
    query: ListCashSessionsQueryDto,
  ): Promise<{ sessions: CashSessionDto[] }> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );
    const isManager = context.roles.some((role) =>
      MANAGER_ROLES.includes(role),
    );
    const sessions = await this.prisma.cashSession.findMany({
      where: {
        branchId,
        ...(query.status ? { status: query.status } : {}),
        ...(isManager ? {} : { cashierStaffUserId: context.staffUserId }),
      },
      orderBy: { openedAt: 'desc' },
      take: query.limit ?? 30,
      include: SESSION_INCLUDE,
    });

    return {
      sessions: await Promise.all(
        sessions.map((session) => this.withLiveFigures(session)),
      ),
    };
  }

  async detail(authUser: JwtPayload, branchId: string, sessionId: string) {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
    );
    const isManager = context.roles.some((role) =>
      MANAGER_ROLES.includes(role),
    );
    const session = await this.prisma.cashSession.findFirst({
      where: { id: sessionId, branchId },
      include: SESSION_INCLUDE,
    });

    if (!session) {
      throw new NotFoundException({
        message: 'La sesion de caja no existe.',
        code: 'CASH_SESSION_NOT_FOUND',
      });
    }

    if (!isManager && session.cashierStaffUserId !== context.staffUserId) {
      throw new ForbiddenException(
        'Solo puedes ver tus propias sesiones de caja.',
      );
    }

    const [payments, movements] = await Promise.all([
      this.prisma.payment.findMany({
        where: { cashSessionId: sessionId },
        orderBy: { paidAt: 'asc' },
        select: {
          id: true,
          billId: true,
          amount: true,
          tipAmount: true,
          method: true,
          status: true,
          paidAt: true,
        },
      }),
      this.prisma.cashMovement.findMany({
        where: { cashSessionId: sessionId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          amount: true,
          reason: true,
          createdAt: true,
          staffUser: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    return {
      session: await this.withLiveFigures(session),
      payments: payments.map((payment) => ({
        id: payment.id,
        billId: payment.billId,
        amount: payment.amount.toFixed(0),
        tipAmount: payment.tipAmount.toFixed(0),
        method: payment.method,
        status: payment.status,
        paidAt: payment.paidAt?.toISOString() ?? null,
      })),
      movements: movements.map((movement) => ({
        id: movement.id,
        type: movement.type,
        amount: movement.amount.toFixed(0),
        reason: movement.reason,
        staffName: personName(movement.staffUser),
        createdAt: movement.createdAt.toISOString(),
      })),
    };
  }

  close(
    authUser: JwtPayload,
    branchId: string,
    sessionId: string,
    dto: CloseCashSessionDto,
    meta: CashRequestMeta,
  ) {
    return this.closeSession(authUser, branchId, sessionId, dto, meta, false);
  }

  forceClose(
    authUser: JwtPayload,
    branchId: string,
    sessionId: string,
    dto: CloseCashSessionDto,
    meta: CashRequestMeta,
  ) {
    return this.closeSession(authUser, branchId, sessionId, dto, meta, true);
  }

  async computeFigures(
    client: Pick<Prisma.TransactionClient, 'payment' | 'cashMovement'>,
    sessionId: string,
    openingFloat: Prisma.Decimal,
  ): Promise<CashSessionFigures> {
    const [sales, movements] = await Promise.all([
      client.payment.aggregate({
        where: {
          cashSessionId: sessionId,
          method: PaymentMethod.CASH,
          status: PaymentStatus.PAID,
        },
        _sum: { amount: true },
      }),
      client.cashMovement.groupBy({
        by: ['type'],
        where: { cashSessionId: sessionId },
        _sum: { amount: true },
      }),
    ]);

    return computeSessionFigures(
      openingFloat,
      sales._sum.amount ?? 0,
      movements.map((row) => ({
        type: row.type,
        amount: row._sum.amount ?? 0,
      })),
    );
  }

  private async closeSession(
    authUser: JwtPayload,
    branchId: string,
    sessionId: string,
    dto: CloseCashSessionDto,
    meta: CashRequestMeta,
    forced: boolean,
  ): Promise<{ session: CashSessionDto; warnings: CashSessionWarnings }> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      forced ? MANAGER_ROLES : [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER],
      { fresh: true },
    );
    const isManager = context.roles.some((role) =>
      MANAGER_ROLES.includes(role),
    );
    const counted = new Prisma.Decimal(dto.countedCash);
    const note = dto.closingNote?.trim() ?? '';

    if (forced && note.length < 3) {
      throw new BadRequestException({
        message: 'El cierre forzado exige un motivo (minimo 3 caracteres).',
        code: 'CASH_SESSION_NOTE_REQUIRED',
      });
    }

    const denominations = this.parseDenominations(dto.denominations);

    const closed = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id::text AS id FROM cash_sessions WHERE id = ${sessionId}::uuid AND branch_id = ${branchId}::uuid FOR UPDATE`,
      );

      if (locked.length === 0) {
        throw new NotFoundException({
          message: 'La sesion de caja no existe.',
          code: 'CASH_SESSION_NOT_FOUND',
        });
      }

      const session = await tx.cashSession.findUniqueOrThrow({
        where: { id: sessionId },
      });

      if (session.status !== CashSessionStatus.OPEN) {
        throw new ConflictException({
          message: 'La sesion de caja ya esta cerrada.',
          code: 'CASH_SESSION_ALREADY_CLOSED',
        });
      }

      if (
        !forced &&
        session.cashierStaffUserId !== context.staffUserId &&
        !context.roles.includes(Role.ADMIN)
      ) {
        throw new ForbiddenException({
          message: 'Solo el cajero de la sesion o un admin puede cerrarla.',
          code: 'CASH_SESSION_NOT_OWNER',
        });
      }

      const figures = await this.computeFigures(
        tx,
        sessionId,
        session.openingFloat,
      );
      const difference = computeDifference(counted, figures.expectedCash);

      if (!difference.isZero() && note.length < 3) {
        throw new BadRequestException({
          message:
            'Hay diferencia entre lo esperado y lo contado: ingresa una nota (minimo 3 caracteres).',
          code: 'CASH_SESSION_NOTE_REQUIRED',
          expectedCash: figures.expectedCash.toFixed(0),
          difference: difference.toFixed(0),
        });
      }

      const warnings = await this.collectWarnings(tx, branchId, sessionId);
      const updated = await tx.cashSession.update({
        where: { id: sessionId },
        data: {
          status: CashSessionStatus.CLOSED,
          closedAt: new Date(),
          closedByStaffUserId: context.staffUserId,
          expectedCash: figures.expectedCash,
          cashSalesAmount: figures.cashSales,
          movementsAmount: figures.movements,
          countedCash: counted,
          difference,
          closingNote: note === '' ? null : note,
          denominations: denominations ?? Prisma.DbNull,
          forced: forced || session.cashierStaffUserId !== context.staffUserId,
        },
        include: SESSION_INCLUDE,
      });

      await this.auditService.record(tx, {
        restaurantId: context.restaurantId,
        branchId,
        actorStaffUserId: context.staffUserId,
        actorRole: isManager
          ? context.roles.includes(Role.ADMIN)
            ? Role.ADMIN
            : Role.SUPERVISOR
          : Role.CASHIER,
        action: forced ? 'CASH_SESSION_FORCE_CLOSED' : 'CASH_SESSION_CLOSED',
        entityType: 'CashSession',
        entityId: sessionId,
        before: { openingFloat: session.openingFloat.toString() },
        after: {
          expectedCash: figures.expectedCash.toString(),
          cashSales: figures.cashSales.toString(),
          movements: figures.movements.toString(),
          countedCash: counted.toString(),
          difference: difference.toString(),
          warnings,
        },
        reason: note === '' ? null : note,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { updated, figures, warnings };
    });

    return {
      session: this.toDto(closed.updated, closed.figures),
      warnings: closed.warnings,
    };
  }

  private async collectWarnings(
    tx: Prisma.TransactionClient,
    branchId: string,
    sessionId: string,
  ): Promise<CashSessionWarnings> {
    const [openBills, partialBillsCollectedInSession] = await Promise.all([
      tx.bill.count({
        where: { branchId, status: { in: OPEN_BILL_STATUSES } },
      }),
      tx.bill.count({
        where: {
          branchId,
          status: BillStatus.PARTIALLY_PAID,
          payments: { some: { cashSessionId: sessionId } },
        },
      }),
    ]);

    return { openBills, partialBillsCollectedInSession };
  }

  private parseDenominations(
    raw: Record<string, number> | undefined,
  ): Prisma.InputJsonObject | null {
    if (!raw) {
      return null;
    }

    const entries = Object.entries(raw);

    if (
      entries.length > 30 ||
      entries.some(
        ([value, count]) =>
          !/^[1-9]\d{0,6}$/.test(value) ||
          !Number.isInteger(count) ||
          count < 0 ||
          count > 100000,
      )
    ) {
      throw new BadRequestException({
        message: 'El conteo por denominacion no es valido.',
        code: 'CASH_DENOMINATIONS_INVALID',
      });
    }

    return Object.fromEntries(entries);
  }

  private async resolveOpenConflict(
    branchId: string,
    staffUserId: string,
    label: string,
    openingFloat: Prisma.Decimal,
  ): Promise<CashSessionDto> {
    const open = await this.prisma.cashSession.findMany({
      where: { branchId, status: CashSessionStatus.OPEN },
      include: SESSION_INCLUDE,
    });
    const mine = open.find(
      (session) => session.cashierStaffUserId === staffUserId,
    );
    const sameLabel = open.find(
      (session) => session.registerLabel.toLowerCase() === label.toLowerCase(),
    );

    if (
      mine &&
      mine.registerLabel.toLowerCase() === label.toLowerCase() &&
      mine.openingFloat.equals(openingFloat)
    ) {
      return this.withLiveFigures(mine);
    }

    if (mine) {
      throw new ConflictException({
        message: 'Ya tienes una caja abierta en esta sucursal.',
        code: 'CASHIER_HAS_OPEN_SESSION',
        sessionId: mine.id,
        registerLabel: mine.registerLabel,
      });
    }

    throw new ConflictException({
      message: 'Esa caja ya esta abierta por otro cajero.',
      code: 'CASH_SESSION_ALREADY_OPEN',
      sessionId: sameLabel?.id ?? null,
      registerLabel: sameLabel?.registerLabel ?? label,
    });
  }

  private async withLiveFigures(
    session: SessionRecord,
  ): Promise<CashSessionDto> {
    return this.toDto(
      session,
      await this.computeFigures(this.prisma, session.id, session.openingFloat),
      session.status === CashSessionStatus.CLOSED,
    );
  }

  private toDto(
    session: SessionRecord,
    figures: CashSessionFigures,
    stored = false,
  ): CashSessionDto {
    return {
      id: session.id,
      branchId: session.branchId,
      registerLabel: session.registerLabel,
      status: session.status,
      cashierStaffUserId: session.cashierStaffUserId,
      cashierName: personName(session.cashier),
      openedAt: session.openedAt.toISOString(),
      closedAt: session.closedAt?.toISOString() ?? null,
      closedByName: personName(session.closedBy),
      forced: session.forced,
      openingFloat: session.openingFloat.toFixed(0),
      cashSalesAmount: stored
        ? (str(session.cashSalesAmount) ?? '0')
        : figures.cashSales.toFixed(0),
      cashInAmount: figures.cashIn.toFixed(0),
      cashOutAmount: figures.cashOut.toFixed(0),
      refundOutAmount: figures.refundOut.toFixed(0),
      otherMovementsAmount: figures.other.toFixed(0),
      movementsAmount: stored
        ? (str(session.movementsAmount) ?? '0')
        : figures.movements.toFixed(0),
      expectedCash: stored
        ? (str(session.expectedCash) ?? '0')
        : figures.expectedCash.toFixed(0),
      countedCash: str(session.countedCash),
      difference: str(session.difference),
      closingNote: session.closingNote,
      denominations: session.denominations,
    };
  }
}
