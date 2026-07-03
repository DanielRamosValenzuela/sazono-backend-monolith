import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  PlatformAdminStatus,
  Prisma,
  StaffUserStatus,
  type PlatformAdmin,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AUTH_PROVIDER } from './application/ports/auth-provider.port';
import type { AuthProvider } from './application/ports/auth-provider.port';
import {
  AuthResponseDto,
  AuthenticatedProfileDto,
} from './dto/auth-response.dto';
import { LoginDto, LoginProfileType } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

type PlatformAdminRecord = PlatformAdmin;
type StaffUserRecord = Prisma.StaffUserGetPayload<{
  include: {
    branchRoles: {
      include: {
        branch: true;
      };
    };
  };
}>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_PROVIDER)
    private readonly authProvider: AuthProvider,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const authenticatedIdentity = await this.authProvider.signInWithPassword(
      loginDto.email,
      loginDto.password,
    );

    if (!authenticatedIdentity) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    const profile = await this.resolveProfileFromAuthUserId(
      authenticatedIdentity.authUserId,
      authenticatedIdentity.email ?? loginDto.email,
      loginDto,
    );

    const payload: JwtPayload = {
      sub: authenticatedIdentity.authUserId,
      profileType: profile.profileType,
      profileId: profile.profileId,
      ...(profile.restaurantId ? { restaurantId: profile.restaurantId } : {}),
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn:
        this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRES_IN') ?? '15m',
      user: profile,
    };
  }

  async getCurrentUser(payload: JwtPayload): Promise<AuthenticatedProfileDto> {
    const authenticatedIdentity = await this.authProvider.getUserById(
      payload.sub,
    );

    if (!authenticatedIdentity) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    return this.resolveProfileFromAuthUserId(
      authenticatedIdentity.authUserId,
      authenticatedIdentity.email ?? '',
      {
        email: authenticatedIdentity.email ?? '',
        password: '',
        profileType: payload.profileType,
        restaurantId: payload.restaurantId,
      },
    );
  }

  private async resolveProfileFromAuthUserId(
    authUserId: string,
    email: string,
    loginDto: LoginDto,
  ): Promise<AuthenticatedProfileDto> {
    const [platformAdmins, staffUsers] = await Promise.all([
      this.prisma.platformAdmin.findMany({
        where: {
          authUserId,
        },
      }),
      this.prisma.staffUser.findMany({
        where: {
          authUserId,
        },
        include: {
          branchRoles: {
            include: {
              branch: true,
            },
          },
        },
      }),
    ]);

    const activePlatformAdmins = platformAdmins.filter(
      (platformAdmin) => platformAdmin.status === PlatformAdminStatus.ACTIVE,
    );

    const activeStaffUsers = staffUsers.filter(
      (staffUser) => staffUser.status === StaffUserStatus.ACTIVE,
    );

    return this.resolveProfile(
      authUserId,
      email,
      activePlatformAdmins,
      activeStaffUsers,
      loginDto,
    );
  }

  private resolveProfile(
    authUserId: string,
    email: string,
    activePlatformAdmins: PlatformAdminRecord[],
    activeStaffUsers: StaffUserRecord[],
    loginDto: LoginDto,
  ): AuthenticatedProfileDto {
    if (!loginDto.profileType && activePlatformAdmins.length > 0) {
      if (activeStaffUsers.length === 0) {
        return this.mapPlatformAdmin(
          authUserId,
          email,
          activePlatformAdmins[0],
        );
      }

      throw new BadRequestException(
        'La identidad puede entrar con mas de un perfil. Debes indicar profileType.',
      );
    }

    if (loginDto.profileType === LoginProfileType.PLATFORM_ADMIN) {
      const platformAdmin = activePlatformAdmins[0];

      if (!platformAdmin) {
        throw new ForbiddenException(
          'La identidad no tiene un perfil platform admin activo.',
        );
      }

      return this.mapPlatformAdmin(authUserId, email, platformAdmin);
    }

    const selectedStaffUser = this.resolveStaffProfile(
      activeStaffUsers,
      loginDto.restaurantId,
    );

    if (!selectedStaffUser) {
      if (activePlatformAdmins.length > 0) {
        throw new BadRequestException(
          'Debes indicar profileType=platform_admin o un perfil staff valido.',
        );
      }

      throw new ForbiddenException(
        'La identidad no tiene un perfil staff activo.',
      );
    }

    return {
      authIdentityId: authUserId,
      profileType: LoginProfileType.STAFF,
      profileId: selectedStaffUser.id,
      email,
      firstName: selectedStaffUser.firstName,
      lastName: selectedStaffUser.lastName,
      restaurantId: selectedStaffUser.restaurantId,
      branchRoles: selectedStaffUser.branchRoles
        .filter((branchRole) => branchRole.status === 'ACTIVE')
        .map((branchRole) => ({
          branchId: branchRole.branchId,
          branchName: branchRole.branch.name,
          role: branchRole.role,
        })),
    };
  }

  private mapPlatformAdmin(
    authUserId: string,
    email: string,
    platformAdmin: PlatformAdminRecord,
  ): AuthenticatedProfileDto {
    return {
      authIdentityId: authUserId,
      profileType: LoginProfileType.PLATFORM_ADMIN,
      profileId: platformAdmin.id,
      email,
      firstName: platformAdmin.firstName,
      lastName: platformAdmin.lastName,
      restaurantId: null,
      branchRoles: [],
    };
  }

  private resolveStaffProfile(
    staffUsers: StaffUserRecord[],
    restaurantId?: string,
  ) {
    if (staffUsers.length === 0) {
      return null;
    }

    if (restaurantId) {
      const matched = staffUsers.find(
        (staffUser) => staffUser.restaurantId === restaurantId,
      );

      if (!matched) {
        throw new ForbiddenException(
          'La identidad no tiene acceso activo a ese restaurante.',
        );
      }

      return matched;
    }

    if (staffUsers.length > 1) {
      throw new BadRequestException(
        'La identidad tiene mas de un perfil staff. Debes indicar restaurantId.',
      );
    }

    return staffUsers[0];
  }
}
