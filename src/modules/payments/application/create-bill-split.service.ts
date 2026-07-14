import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  BillSplitMode,
  BillSplitStatus,
  BillStatus,
  Prisma,
  Role,
  TableStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ACTIVE_TABLE_SESSION_STATUSES } from '../../floor/domain/active-table-session-statuses';
import { BILL_SPLIT_INCLUDE, mapBillSplit } from './bill-split-mapper';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  BillSplitResponseDto,
  CreateBillSplitDto,
} from '../presentation/http/dto/payments.dto';

const SPLITTABLE_BILL_STATUSES: BillStatus[] = [
  BillStatus.OPEN,
  BillStatus.PARTIALLY_PAID,
];

@Injectable()
export class CreateBillSplitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}
  async executeForStaff(
    authUser: JwtPayload,
    billId: string,
    dto: CreateBillSplitDto,
  ): Promise<BillSplitResponseDto> {
    const bill = await this.loadSplittableBill(billId);

    await this.branchAccessService.ensureAccess(authUser, bill.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.CASHIER,
    ]);

    return this.createSplit(bill, dto);
  }

  async executeForQrToken(
    qrToken: string,
    dto: CreateBillSplitDto,
  ): Promise<BillSplitResponseDto> {
    const bill = await this.loadBillByQrToken(qrToken);
    return this.createSplit(bill, dto);
  }

  private async loadSplittableBill(billId: string) {
    const bill = await this.prisma.bill.findUnique({
      where: {
        id: billId,
      },
      include: {
        branch: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!bill) {
      throw new BadRequestException('La cuenta indicada no existe.');
    }

    return bill;
  }

  private async loadBillByQrToken(qrToken: string) {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new BadRequestException('El QR indicado no esta disponible.');
    }

    const activeSession = await this.prisma.tableSession.findFirst({
      where: {
        tableId: table.id,
        status: {
          in: ACTIVE_TABLE_SESSION_STATUSES,
        },
      },
      include: {
        bill: {
          include: {
            branch: {
              include: {
                settings: true,
              },
            },
          },
        },
      },
    });

    if (!activeSession?.bill) {
      throw new BadRequestException(
        'La mesa no tiene una cuenta abierta para dividir.',
      );
    }

    return activeSession.bill;
  }

  private async createSplit(
    bill: {
      id: string;
      branchId: string;
      status: BillStatus;
      remainingAmount: Prisma.Decimal;
      branch: {
        settings: {
          splitBillEnabled: boolean;
        } | null;
      };
    },
    dto: CreateBillSplitDto,
  ): Promise<BillSplitResponseDto> {
    if (!bill.branch.settings?.splitBillEnabled) {
      throw new BadRequestException(
        'La sucursal no tiene habilitado el split bill.',
      );
    }

    if (!SPLITTABLE_BILL_STATUSES.includes(bill.status)) {
      throw new ConflictException(
        'La cuenta indicada no admite split en su estado actual.',
      );
    }

    if (bill.remainingAmount.lte(0)) {
      throw new BadRequestException(
        'La cuenta no tiene saldo pendiente para dividir.',
      );
    }

    const existingOpenSplit = await this.prisma.billSplit.findFirst({
      where: {
        billId: bill.id,
        status: {
          in: [BillSplitStatus.OPEN, BillSplitStatus.PARTIALLY_PAID],
        },
      },
    });

    if (existingOpenSplit) {
      throw new ConflictException(
        'La cuenta ya tiene un split activo. Consulta el split actual o espera a que se complete.',
      );
    }

    const allocations = dto.participants.map((participant) => ({
      displayName: participant.displayName?.trim() || null,
      amount: new Prisma.Decimal(participant.amount),
    }));

    const totalAllocated = allocations.reduce(
      (total, participant) => total.add(participant.amount),
      new Prisma.Decimal(0),
    );

    if (!totalAllocated.equals(bill.remainingAmount)) {
      throw new BadRequestException(
        'La suma de las partes debe coincidir exactamente con el saldo pendiente de la cuenta.',
      );
    }

    if (allocations.some((participant) => participant.amount.lte(0))) {
      throw new BadRequestException(
        'Cada participante debe tener una parte mayor a cero.',
      );
    }

    const split = await this.prisma.billSplit.create({
      data: {
        billId: bill.id,
        splitMode: BillSplitMode.BY_AMOUNT,
        status: BillSplitStatus.OPEN,
        participants: {
          create: allocations.map((participant) => ({
            participantToken: randomUUID(),
            displayName: participant.displayName,
            allocatedAmount: participant.amount,
          })),
        },
      },
      include: BILL_SPLIT_INCLUDE,
    });

    return mapBillSplit(split);
  }
}
