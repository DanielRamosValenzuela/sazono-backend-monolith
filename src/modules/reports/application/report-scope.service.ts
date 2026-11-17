import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  isDateKey,
  zonedDateKey,
  zonedStartOfDay,
} from '../../../common/time/restaurant-time';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ReportsPrismaRepository } from '../infrastructure/reports.prisma.repository';
import {
  MAX_CSV_RANGE_DAYS,
  MAX_RANGE_DAYS,
  METHOD_KEYS,
  type MethodKey,
  type ReportScope,
} from './report-types';

export type ReportScopeQuery = {
  from?: string;
  to?: string;
  cashierId?: string;
  method?: string;
};

const REPORT_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR, Role.CASHIER];
const FULL_ACCESS_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR];

function parseMethods(raw: string | undefined): MethodKey[] {
  if (!raw) {
    return [];
  }

  const requested = raw.split(',').map((value) => value.trim());
  const invalid = requested.filter(
    (value) => !METHOD_KEYS.includes(value as MethodKey),
  );

  if (invalid.length > 0) {
    throw new BadRequestException(
      `Medio de pago no valido: ${invalid.join(', ')}.`,
    );
  }

  return [...new Set(requested as MethodKey[])];
}

@Injectable()
export class ReportScopeService {
  constructor(
    private readonly branchAccessService: BranchAccessService,
    private readonly reportsRepository: ReportsPrismaRepository,
  ) {}

  async resolve(
    authUser: JwtPayload,
    branchId: string,
    query: ReportScopeQuery,
    options: { forCsv: boolean; fullAccessOnly?: boolean },
  ): Promise<ReportScope> {
    const context = await this.branchAccessService.ensureAccess(
      authUser,
      branchId,
      options.fullAccessOnly ? FULL_ACCESS_ROLES : REPORT_ROLES,
    );
    const timeZone = await this.reportsRepository.findBranchTimezone(branchId);

    if (timeZone === null) {
      throw new NotFoundException('La sucursal indicada no existe.');
    }

    const methods = parseMethods(query.method);
    const cashierScoped = !context.roles.some((role) =>
      FULL_ACCESS_ROLES.includes(role),
    );

    if (cashierScoped) {
      const today = zonedDateKey(new Date(), timeZone);

      return this.buildScope(branchId, timeZone, today, today, {
        cashierId: context.staffUserId,
        methods,
        cashierScoped,
      });
    }

    const { from, to } = this.validateRange(query, options.forCsv);

    return this.buildScope(branchId, timeZone, from, to, {
      cashierId: query.cashierId ?? null,
      methods,
      cashierScoped,
    });
  }

  private validateRange(
    query: ReportScopeQuery,
    forCsv: boolean,
  ): { from: string; to: string } {
    if (!query.from || !query.to) {
      throw new BadRequestException(
        'Debes indicar "from" y "to" (YYYY-MM-DD).',
      );
    }

    if (!isDateKey(query.from) || !isDateKey(query.to)) {
      throw new BadRequestException(
        'Las fechas deben tener el formato YYYY-MM-DD y ser validas.',
      );
    }

    if (query.from > query.to) {
      throw new BadRequestException('"from" debe ser anterior o igual a "to".');
    }

    const maxDays = forCsv ? MAX_CSV_RANGE_DAYS : MAX_RANGE_DAYS;

    if (daysBetweenDateKeys(query.from, query.to) + 1 > maxDays) {
      throw new BadRequestException(
        `El rango no puede superar ${maxDays} dias.`,
      );
    }

    return { from: query.from, to: query.to };
  }

  private buildScope(
    branchId: string,
    timeZone: string,
    from: string,
    to: string,
    rest: Pick<ReportScope, 'cashierId' | 'methods' | 'cashierScoped'>,
  ): ReportScope {
    return {
      branchId,
      timeZone,
      from,
      to,
      start: zonedStartOfDay(from, timeZone),
      end: zonedStartOfDay(addDaysToDateKey(to, 1), timeZone),
      ...rest,
    };
  }
}
