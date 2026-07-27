import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  RenameTableZoneDto,
  TableZoneResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class RenameTableZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    zoneId: string,
    dto: RenameTableZoneDto,
  ): Promise<TableZoneResponseDto> {
    const zone = await this.prisma.tableZone.findUnique({
      where: {
        id: zoneId,
      },
    });

    if (!zone) {
      throw new BadRequestException('La zona indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(authUser, zone.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    let updatedZone;

    try {
      updatedZone = await this.prisma.tableZone.update({
        where: {
          id: zoneId,
        },
        data: {
          name: dto.name,
        },
        include: {
          tables: {
            select: {
              id: true,
            },
          },
          staffMembers: {
            select: {
              staffUserId: true,
            },
          },
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
      zoneId: updatedZone.id,
      branchId: updatedZone.branchId,
      name: updatedZone.name,
      tableIds: updatedZone.tables.map((table) => table.id),
      staffUserIds: updatedZone.staffMembers.map(
        (member) => member.staffUserId,
      ),
    };
  }
}
