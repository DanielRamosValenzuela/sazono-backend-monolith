import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AUTH_PROVIDER } from '../../auth/application/ports/auth-provider.port';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import { Inject } from '@nestjs/common';
import {
  BootstrapRestaurantDto,
  BootstrapRestaurantResponseDto,
} from '../presentation/http/dto/bootstrap-restaurant.dto';

@Injectable()
export class BootstrapRestaurantService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_PROVIDER)
    private readonly authProvider: AuthProvider,
  ) {}

  async execute(
    dto: BootstrapRestaurantDto,
  ): Promise<BootstrapRestaurantResponseDto> {
    const authIdentity = await this.authProvider.createUser({
      email: dto.admin.email,
      password: dto.admin.password,
      emailConfirmed: true,
      userMetadata: {
        first_name: dto.admin.firstName,
        last_name: dto.admin.lastName,
        kind: 'staff_admin',
      },
    });

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const restaurant = await tx.restaurant.create({
          data: {
            name: dto.restaurant.name,
            legalName: dto.restaurant.legalName,
            defaultLanguage: dto.restaurant.defaultLanguage,
            timezone: dto.restaurant.timezone,
            currency: dto.restaurant.currency,
          },
        });

        const staffUser = await tx.staffUser.create({
          data: {
            authUserId: authIdentity.authUserId,
            restaurantId: restaurant.id,
            firstName: dto.admin.firstName,
            lastName: dto.admin.lastName,
            status: 'ACTIVE',
          },
        });

        return { restaurant, staffUser };
      });

      return {
        restaurantId: result.restaurant.id,
        restaurantName: result.restaurant.name,
        firstAdmin: {
          authUserId: authIdentity.authUserId,
          staffUserId: result.staffUser.id,
          email: authIdentity.email ?? dto.admin.email,
          firstName: result.staffUser.firstName,
          lastName: result.staffUser.lastName,
        },
      };
    } catch (error) {
      await this.authProvider.deleteUser(authIdentity.authUserId);
      throw error;
    }
  }
}
