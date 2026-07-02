import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PlatformAdminStatus, Prisma, StaffUserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthResponseDto, AuthenticatedProfileDto } from './dto/auth-response.dto';
import { LoginDto, LoginProfileType } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const authIdentityInclude = {
  platformAdmins: true,
  staffUsers: {
    include: {
      branchRoles: {
        include: {
          branch: true,
        },
      },
    },
  },
} satisfies Prisma.AuthIdentityInclude;

type AuthIdentityWithProfiles = Prisma.AuthIdentityGetPayload<{
  include: typeof authIdentityInclude;
}>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    const authIdentity = await this.prisma.authIdentity.findUnique({
      where: {
        email: loginDto.email,
      },
      include: authIdentityInclude,
    });

    if (!authIdentity) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    if (authIdentity.status !== 'ACTIVE') {
      throw new ForbiddenException('La identidad base no esta habilitada.');
    }

    const passwordMatches = await argon2.verify(
      authIdentity.passwordHash,
      loginDto.password,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    const profile = this.resolveProfile(authIdentity, loginDto);
    const payload: JwtPayload = {
      sub: authIdentity.id,
      profileType: profile.profileType,
      profileId: profile.profileId,
      ...(profile.restaurantId ? { restaurantId: profile.restaurantId } : {}),
    };

    const accessToken = await this.jwtService.signAsync(payload);

    await this.prisma.authIdentity.update({
      where: {
        id: authIdentity.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn:
        this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRES_IN') ?? '15m',
      user: profile,
    };
  }

  async getCurrentUser(payload: JwtPayload): Promise<AuthenticatedProfileDto> {
    const authIdentity = await this.prisma.authIdentity.findUnique({
      where: {
        id: payload.sub,
      },
      include: authIdentityInclude,
    });

    if (!authIdentity || authIdentity.status !== 'ACTIVE') {
      throw new UnauthorizedException('Sesion invalida.');
    }

    return this.resolveProfile(authIdentity, {
      email: authIdentity.email,
      password: '',
      profileType: payload.profileType,
      restaurantId: payload.restaurantId,
    });
  }

  private resolveProfile(
    authIdentity: AuthIdentityWithProfiles,
    loginDto: LoginDto,
  ): AuthenticatedProfileDto {
    const activePlatformAdmins = authIdentity.platformAdmins.filter(
      (platformAdmin) =>
        platformAdmin.status === PlatformAdminStatus.ACTIVE,
    );

    const activeStaffUsers = authIdentity.staffUsers.filter(
      (staffUser) => staffUser.status === StaffUserStatus.ACTIVE,
    );

    if (!loginDto.profileType && activePlatformAdmins.length > 0) {
      if (activeStaffUsers.length === 0) {
        const platformAdmin = activePlatformAdmins[0];

        return {
          authIdentityId: authIdentity.id,
          profileType: LoginProfileType.PLATFORM_ADMIN,
          profileId: platformAdmin.id,
          email: authIdentity.email,
          firstName: platformAdmin.firstName,
          lastName: platformAdmin.lastName,
          restaurantId: null,
          branchRoles: [],
        };
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

      return {
        authIdentityId: authIdentity.id,
        profileType: LoginProfileType.PLATFORM_ADMIN,
        profileId: platformAdmin.id,
        email: authIdentity.email,
        firstName: platformAdmin.firstName,
        lastName: platformAdmin.lastName,
        restaurantId: null,
        branchRoles: [],
      };
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
      authIdentityId: authIdentity.id,
      profileType: LoginProfileType.STAFF,
      profileId: selectedStaffUser.id,
      email: authIdentity.email,
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

  private resolveStaffProfile(
    staffUsers: AuthIdentityWithProfiles['staffUsers'],
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
