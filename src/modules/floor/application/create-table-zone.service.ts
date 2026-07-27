import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  CreateTableZoneDto,
  TableZoneResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class CreateTableZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: CreateTableZoneDto,
  ): Promise<TableZoneResponseDto> {
    await this.branchAccessService.ensureAccess(authUser, dto.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    let createdZone;

    try {
      createdZone = await this.prisma.tableZone.create({
        data: {
          branchId: dto.branchId,
          name: dto.name,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe una zona con ese nombre en esta sucursal.',
        );
      }
      throw error;
    }

    return {
      zoneId: createdZone.id,
      branchId: createdZone.branchId,
      name: createdZone.name,
      tableIds: [],
      staffUserIds: [],
    };
  }
}
