import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { slugify } from '../../../common/slug/slugify';
import { AUTH_PROVIDER } from '../../auth/application/ports/auth-provider.port';
import type {
  AuthenticatedIdentity,
  AuthProvider,
} from '../../auth/application/ports/auth-provider.port';
import { Inject } from '@nestjs/common';
import {
  BootstrapRestaurantDto,
  BootstrapRestaurantResponseDto,
} from '../presentation/http/dto/bootstrap-restaurant.dto';

function isDuplicateEmailError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    status?: number;
    code?: string;
    message?: string;
  };
  if (candidate.code === 'email_exists') {
    return true;
  }
  if (candidate.status === 422 || candidate.status === 400) {
    const message = candidate.message?.toLowerCase() ?? '';
    return (
      message.includes('already registered') ||
      message.includes('already exists') ||
      message.includes('already been registered')
    );
  }
  return false;
}

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
    let authIdentity: AuthenticatedIdentity;
    try {
      authIdentity = await this.authProvider.createUser({
        email: dto.admin.email,
        password: dto.admin.password,
        emailConfirmed: true,
        userMetadata: {
          first_name: dto.admin.firstName,
          last_name: dto.admin.lastName,
          kind: 'staff_admin',
        },
      });
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new ConflictException(
          'Ya existe una cuenta con este correo. Usa otro correo para el primer administrador.',
        );
      }
      throw error;
    }

    try {
      const slug = await this.generateUniqueSlug(dto.restaurant.name);

      const result = await this.prisma.$transaction(async (tx) => {
        const restaurant = await tx.restaurant.create({
          data: {
            name: dto.restaurant.name,
            legalName: dto.restaurant.legalName,
            slug,
            branchQuota: dto.restaurant.branchQuota ?? 1,
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
        restaurantSlug: result.restaurant.slug,
        branchQuota: result.restaurant.branchQuota,
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

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'restaurante';
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.restaurant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}
