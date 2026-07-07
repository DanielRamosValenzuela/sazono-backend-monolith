import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BranchRoleStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AUTH_PROVIDER } from '../../auth/application/ports/auth-provider.port';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import type { RestaurantDetailResponseDto } from '../presentation/http/dto/restaurant-detail.dto';

@Injectable()
export class GetRestaurantDetailService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_PROVIDER)
    private readonly authProvider: AuthProvider,
  ) {}

  async execute(restaurantId: string): Promise<RestaurantDetailResponseDto> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: {
        id: restaurantId,
      },
      include: {
        branches: {
          select: {
            id: true,
            name: true,
            address: true,
            status: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        staffUsers: {
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
        },
      },
    });

    if (!restaurant) {
      throw new NotFoundException('El restaurante no existe.');
    }

    const identities = await Promise.all(
      restaurant.staffUsers.map((staffUser) =>
        this.authProvider.getUserById(staffUser.authUserId),
      ),
    );
    const emailByAuthUserId = new Map<string, string | null>();

    identities.forEach((identity) => {
      if (identity) {
        emailByAuthUserId.set(identity.authUserId, identity.email);
      }
    });

    return {
      restaurantId: restaurant.id,
      name: restaurant.name,
      legalName: restaurant.legalName,
      status: restaurant.status,
      currency: restaurant.currency,
      timezone: restaurant.timezone,
      defaultLanguage: restaurant.defaultLanguage,
      createdAt: restaurant.createdAt.toISOString(),
      branches: restaurant.branches.map((branch) => ({
        branchId: branch.id,
        name: branch.name,
        address: branch.address,
        status: branch.status,
      })),
      staff: restaurant.staffUsers.map((staffUser) => ({
        staffUserId: staffUser.id,
        email: emailByAuthUserId.get(staffUser.authUserId) ?? null,
        firstName: staffUser.firstName,
        lastName: staffUser.lastName,
        status: staffUser.status,
        branchRoles: staffUser.branchRoles.map((branchRole) => ({
          branchId: branchRole.branchId,
          branchName: branchRole.branch.name,
          role: branchRole.role,
        })),
      })),
    };
  }
}
