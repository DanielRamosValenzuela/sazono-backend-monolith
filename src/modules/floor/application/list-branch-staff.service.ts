import { Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { FLOOR_ASSIGN_ROLES } from '../domain/floor-assignment-roles';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import type {
  BranchStaffMemberResponseDto,
  ListTablesQueryDto,
} from '../presentation/http/dto/floor.dto';

@Injectable()
export class ListBranchStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListTablesQueryDto,
  ): Promise<BranchStaffMemberResponseDto[]> {
    await this.branchAccessService.ensureAccess(authUser, query.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    const rows = await this.prisma.staffUserBranchRole.findMany({
      where: {
        branchId: query.branchId,
        status: BranchRoleStatus.ACTIVE,
        role: {
          in: FLOOR_ASSIGN_ROLES,
        },
        staffUser: {
          status: StaffUserStatus.ACTIVE,
        },
      },
      select: {
        staffUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      distinct: ['staffUserId'],
    });

    return rows
      .map((row) => ({
        staffUserId: row.staffUser.id,
        firstName: row.staffUser.firstName,
        lastName: row.staffUser.lastName,
      }))
      .sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(
          `${b.firstName} ${b.lastName}`,
        ),
      );
  }
}
