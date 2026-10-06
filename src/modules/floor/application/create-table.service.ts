import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, TableStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { COUNTER_TABLE_CODE } from '../domain/counter-table';
import type {
  CreateTableDto,
  TableResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class CreateTableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: CreateTableDto,
  ): Promise<TableResponseDto> {
    await this.branchAccessService.ensureAccess(authUser, dto.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    if (dto.code.trim().toUpperCase() === COUNTER_TABLE_CODE) {
      throw new BadRequestException(
        `El codigo ${COUNTER_TABLE_CODE} esta reservado para la mesa virtual.`,
      );
    }

    const existingTable = await this.prisma.table.findFirst({
      where: {
        branchId: dto.branchId,
        code: dto.code,
      },
    });

    if (existingTable) {
      throw new ConflictException(
        'Ya existe una mesa con ese codigo en la sucursal.',
      );
    }

    const table = await this.prisma.table.create({
      data: {
        branchId: dto.branchId,
        code: dto.code,
        name: dto.name,
        capacity: dto.capacity,
        qrToken: randomUUID(),
        status: TableStatus.AVAILABLE,
      },
    });

    return {
      tableId: table.id,
      branchId: table.branchId,
      code: table.code,
      name: table.name,
      capacity: table.capacity,
      status: table.status,
      qrToken: table.qrToken,
      zoneId: table.zoneId,
      currentSession: null,
    };
  }
}
