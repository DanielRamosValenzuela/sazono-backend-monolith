import { Inject, Injectable } from '@nestjs/common';
import { BranchRoleStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AUTH_PROVIDER } from '../../auth/application/ports/auth-provider.port';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { StaffAdminAccessService } from './staff-admin-access.service';
import type { StaffUserResponseDto } from '../presentation/http/dto/staff.dto';

@Injectable()
export class ListStaffUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAdminAccessService: StaffAdminAccessService,
    @Inject(AUTH_PROVIDER)
    private readonly authProvider: AuthProvider,
  ) {}

  async execute(authUser: JwtPayload): Promise<StaffUserResponseDto[]> {
    const context =
      await this.staffAdminAccessService.getAdminContext(authUser);

    const staffUsers = await this.prisma.staffUser.findMany({
      where: {
        restaurantId: context.restaurantId,
      },
      include: {
        branchRoles: {
          where: {
            status: BranchRoleStatus.ACTIVE,
          },
          include: {
            branch: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const identities = await Promise.all(
      staffUsers.map((staffUser) =>
        this.authProvider.getUserById(staffUser.authUserId),
      ),
    );
    const emailByAuthUserId = new Map<string, string | null>();

    identities.forEach((identity) => {
      if (identity) {
        emailByAuthUserId.set(identity.authUserId, identity.email);
      }
    });

    return staffUsers.map((staffUser) => ({
      staffUserId: staffUser.id,
      authUserId: staffUser.authUserId,
      restaurantId: staffUser.restaurantId,
      email: emailByAuthUserId.get(staffUser.authUserId) ?? null,
      firstName: staffUser.firstName,
      lastName: staffUser.lastName,
      status: staffUser.status,
      branchRoles: staffUser.branchRoles.map((branchRole) => ({
        branchId: branchRole.branchId,
        branchName: branchRole.branch.name,
        role: branchRole.role,
      })),
    }));
  }
}
