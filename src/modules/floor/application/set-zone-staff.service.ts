import { BadRequestException, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { FLOOR_ASSIGN_ROLES } from '../domain/floor-assignment-roles';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  SetZoneStaffDto,
  TableZoneResponseDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class SetZoneStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    zoneId: string,
    dto: SetZoneStaffDto,
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

    const uniqueStaffUserIds = Array.from(new Set(dto.staffUserIds));

    if (uniqueStaffUserIds.length > 0) {
      const eligibleStaff = await this.prisma.staffUserBranchRole.findMany({
        where: {
          staffUserId: {
            in: uniqueStaffUserIds,
          },
          branchId: zone.branchId,
          status: BranchRoleStatus.ACTIVE,
          role: {
            in: FLOOR_ASSIGN_ROLES,
          },
          staffUser: {
            status: StaffUserStatus.ACTIVE,
          },
        },
        select: {
          staffUserId: true,
        },
        distinct: ['staffUserId'],
      });

      if (eligibleStaff.length !== uniqueStaffUserIds.length) {
        throw new BadRequestException(
          'Uno o mas miembros del equipo indicados no tienen un rol operativo activo en esta sucursal.',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.staffUserZone.deleteMany({
        where: {
          zoneId,
        },
      }),
      this.prisma.staffUserZone.createMany({
        data: uniqueStaffUserIds.map((staffUserId) => ({
          staffUserId,
          zoneId,
        })),
      }),
    ]);

    const updatedZone = await this.prisma.tableZone.findUnique({
      where: {
        id: zoneId,
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

    return {
      zoneId: updatedZone!.id,
      branchId: updatedZone!.branchId,
      name: updatedZone!.name,
      tableIds: updatedZone!.tables.map((table) => table.id),
      staffUserIds: updatedZone!.staffMembers.map(
        (member) => member.staffUserId,
      ),
    };
  }
}
