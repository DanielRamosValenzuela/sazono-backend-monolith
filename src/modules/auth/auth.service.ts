import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import {
  PlatformAdminStatus,
  Prisma,
  StaffUserStatus,
  type PlatformAdmin,
} from '@prisma/client';
import type { StringValue } from 'ms';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AUTH_PROVIDER } from './application/ports/auth-provider.port';
import type { AuthProvider } from './application/ports/auth-provider.port';
import {
  AuthResponseDto,
  AuthenticatedProfileDto,
} from './dto/auth-response.dto';
import { LoginDto, LoginProfileType } from './dto/login.dto';
import type { PinLoginDto, SetPinDto } from './dto/pin.dto';
import {
  JwtPayload,
  RefreshTokenPayload,
} from './interfaces/jwt-payload.interface';

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

interface SignedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  expiresAt: string;
}

const DEFAULT_REFRESH_TOKEN_SECRET = 'change-me-refresh';
const DEFAULT_REFRESH_TOKEN_EXPIRES_IN = '30d' as StringValue;

const PIN_SALT_ROUNDS = 10;
const PIN_MAX_FAILED_ATTEMPTS = 5;
const PIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000;

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

    const resolvedRestaurantId = await this.resolveRestaurantIdFromSlug(
      loginDto.restaurantSlug,
    );

    const profile = await this.resolveProfileFromAuthUserId(
      authenticatedIdentity.authUserId,
      authenticatedIdentity.email ?? loginDto.email,
      loginDto,
      resolvedRestaurantId,
    );

    const payload: JwtPayload = {
      sub: authenticatedIdentity.authUserId,
      profileType: profile.profileType,
      profileId: profile.profileId,
      ...(profile.restaurantId ? { restaurantId: profile.restaurantId } : {}),
    };

    const { accessToken, refreshToken, expiresIn, expiresAt } =
      await this.signTokens(payload);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn,
      expiresAt,
      user: profile,
    };
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const decodedPayload = await this.verifyRefreshToken(refreshToken);

    const profile = await this.getCurrentUser(decodedPayload);

    const payload: JwtPayload = {
      sub: decodedPayload.sub,
      profileType: decodedPayload.profileType,
      profileId: decodedPayload.profileId,
      ...(decodedPayload.restaurantId
        ? { restaurantId: decodedPayload.restaurantId }
        : {}),
    };

    const {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
      expiresAt,
    } = await this.signTokens(payload);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn,
      expiresAt,
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
      },
      payload.restaurantId,
    );
  }

  async setPin(user: JwtPayload, dto: SetPinDto): Promise<void> {
    if (user.profileType !== LoginProfileType.STAFF) {
      throw new ForbiddenException(
        'Solo un perfil staff puede configurar un PIN.',
      );
    }

    const pinHash = await bcrypt.hash(dto.pin, PIN_SALT_ROUNDS);

    await this.prisma.staffUser.update({
      where: {
        id: user.profileId,
      },
      data: {
        pinHash,
        pinSetAt: new Date(),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });
  }

  async loginWithPin(dto: PinLoginDto): Promise<AuthResponseDto> {
    const staffUser = await this.prisma.staffUser.findUnique({
      where: {
        id: dto.staffUserId,
      },
      include: {
        branchRoles: {
          include: {
            branch: true,
          },
        },
      },
    });

    if (
      !staffUser ||
      staffUser.status !== StaffUserStatus.ACTIVE ||
      !staffUser.pinHash
    ) {
      throw new UnauthorizedException('PIN invalido.');
    }

    if (staffUser.pinLockedUntil && staffUser.pinLockedUntil > new Date()) {
      throw new UnauthorizedException(
        'PIN bloqueado temporalmente por demasiados intentos fallidos. Intenta mas tarde o entra con tu contrasena.',
      );
    }

    const isValidPin = await bcrypt.compare(dto.pin, staffUser.pinHash);

    if (!isValidPin) {
      await this.registerFailedPinAttempt(
        staffUser.id,
        staffUser.pinFailedAttempts,
      );

      throw new UnauthorizedException('PIN invalido.');
    }

    await this.prisma.staffUser.update({
      where: {
        id: staffUser.id,
      },
      data: {
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });

    const authenticatedIdentity = await this.authProvider.getUserById(
      staffUser.authUserId,
    );

    if (!authenticatedIdentity) {
      throw new UnauthorizedException('PIN invalido.');
    }

    const profile = this.mapStaffUser(
      staffUser.authUserId,
      authenticatedIdentity.email ?? '',
      staffUser,
    );

    const payload: JwtPayload = {
      sub: staffUser.authUserId,
      profileType: LoginProfileType.STAFF,
      profileId: staffUser.id,
      restaurantId: staffUser.restaurantId,
    };

    const { accessToken, refreshToken, expiresIn, expiresAt } =
      await this.signTokens(payload);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn,
      expiresAt,
      user: profile,
    };
  }

  private async registerFailedPinAttempt(
    staffUserId: string,
    currentFailedAttempts: number,
  ): Promise<void> {
    const nextFailedAttempts = currentFailedAttempts + 1;
    const shouldLock = nextFailedAttempts >= PIN_MAX_FAILED_ATTEMPTS;

    await this.prisma.staffUser.update({
      where: {
        id: staffUserId,
      },
      data: {
        pinFailedAttempts: shouldLock ? 0 : nextFailedAttempts,
        ...(shouldLock
          ? { pinLockedUntil: new Date(Date.now() + PIN_LOCKOUT_DURATION_MS) }
          : {}),
      },
    });
  }

  private async signTokens(payload: JwtPayload): Promise<SignedTokens> {
    const expiresIn =
      this.configService.get<string>('JWT_ACCESS_TOKEN_EXPIRES_IN') ?? '8h';
    const refreshTokenSecret =
      this.configService.get<string>('JWT_REFRESH_TOKEN_SECRET') ??
      DEFAULT_REFRESH_TOKEN_SECRET;
    const refreshTokenExpiresIn = (this.configService.get<string>(
      'JWT_REFRESH_TOKEN_EXPIRES_IN',
    ) ?? DEFAULT_REFRESH_TOKEN_EXPIRES_IN) as StringValue;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(
        { ...payload, type: 'refresh' },
        {
          secret: refreshTokenSecret,
          expiresIn: refreshTokenExpiresIn,
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn,
      expiresAt: this.resolveAccessTokenExpiresAt(accessToken),
    };
  }

  private async verifyRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenPayload> {
    const refreshTokenSecret =
      this.configService.get<string>('JWT_REFRESH_TOKEN_SECRET') ??
      DEFAULT_REFRESH_TOKEN_SECRET;

    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: refreshTokenSecret,
        },
      );
    } catch {
      throw new UnauthorizedException('Refresh token invalido o expirado.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token invalido o expirado.');
    }

    return payload;
  }

  private async resolveRestaurantIdFromSlug(
    restaurantSlug?: string,
  ): Promise<string | undefined> {
    if (!restaurantSlug) {
      return undefined;
    }

    const restaurant = await this.prisma.restaurant.findUnique({
      where: {
        slug: restaurantSlug,
      },
      select: {
        id: true,
      },
    });

    if (!restaurant) {
      throw new UnauthorizedException('Credenciales invalidas.');
    }

    return restaurant.id;
  }

  private resolveAccessTokenExpiresAt(accessToken: string): string {
    const decodedToken = this.jwtService.decode(accessToken);

    if (
      !decodedToken ||
      typeof decodedToken === 'string' ||
      typeof decodedToken.exp !== 'number'
    ) {
      throw new UnauthorizedException(
        'No se pudo calcular la expiracion del token.',
      );
    }

    return new Date(decodedToken.exp * 1000).toISOString();
  }

  private async resolveProfileFromAuthUserId(
    authUserId: string,
    email: string,
    loginDto: LoginDto,
    restaurantId?: string,
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
      restaurantId,
    );
  }

  private resolveProfile(
    authUserId: string,
    email: string,
    activePlatformAdmins: PlatformAdminRecord[],
    activeStaffUsers: StaffUserRecord[],
    loginDto: LoginDto,
    restaurantId?: string,
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
      restaurantId,
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

    return this.mapStaffUser(authUserId, email, selectedStaffUser);
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

  private mapStaffUser(
    authUserId: string,
    email: string,
    staffUser: StaffUserRecord,
  ): AuthenticatedProfileDto {
    return {
      authIdentityId: authUserId,
      profileType: LoginProfileType.STAFF,
      profileId: staffUser.id,
      email,
      firstName: staffUser.firstName,
      lastName: staffUser.lastName,
      restaurantId: staffUser.restaurantId,
      branchRoles: staffUser.branchRoles
        .filter((branchRole) => branchRole.status === 'ACTIVE')
        .map((branchRole) => ({
          branchId: branchRole.branchId,
          branchName: branchRole.branch.name,
          role: branchRole.role,
        })),
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
