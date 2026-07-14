import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { PlatformAdminStatus, StaffUserStatus } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import { LoginProfileType } from './dto/login.dto';
import type { AuthProvider } from './application/ports/auth-provider.port';

describe('AuthService.login', () => {
  const signInWithPasswordMock = jest.fn();
  const authProvider = {
    signInWithPassword: signInWithPasswordMock,
  } as unknown as AuthProvider;

  const restaurantFindUniqueMock = jest.fn();
  const platformAdminFindManyMock = jest.fn().mockResolvedValue([]);
  const staffUserFindManyMock = jest.fn().mockResolvedValue([]);

  const prisma = {
    restaurant: {
      findUnique: restaurantFindUniqueMock,
    },
    platformAdmin: {
      findMany: platformAdminFindManyMock,
    },
    staffUser: {
      findMany: staffUserFindManyMock,
    },
  } as unknown as PrismaService;

  const signAsyncMock = jest.fn().mockResolvedValue('signed-jwt');
  const decodeMock = jest.fn().mockReturnValue({ exp: 1_784_019_600 });
  const jwtService = {
    signAsync: signAsyncMock,
    decode: decodeMock,
  } as unknown as JwtService;
  const configService = {
    get: jest.fn().mockReturnValue('8h'),
  } as unknown as ConfigService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    platformAdminFindManyMock.mockResolvedValue([]);
    staffUserFindManyMock.mockResolvedValue([]);
    signAsyncMock.mockResolvedValue('signed-jwt');
    decodeMock.mockReturnValue({ exp: 1_784_019_600 });
    service = new AuthService(prisma, authProvider, jwtService, configService);
  });

  it('rejects with a generic error when the restaurant slug does not exist', async () => {
    signInWithPasswordMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: 'mesero@resto.cl',
    });
    restaurantFindUniqueMock.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'mesero@resto.cl',
        password: 'Password123!',
        profileType: LoginProfileType.STAFF,
        restaurantSlug: 'no-existe',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(staffUserFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects when the credentials belong to a different restaurant than the slug', async () => {
    signInWithPasswordMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: 'mesero@resto.cl',
    });
    restaurantFindUniqueMock.mockResolvedValue({ id: 'restaurant-target' });
    staffUserFindManyMock.mockResolvedValue([
      {
        id: 'staff-1',
        authUserId: 'auth-1',
        restaurantId: 'restaurant-other',
        firstName: 'Ana',
        lastName: 'Diaz',
        status: StaffUserStatus.ACTIVE,
        branchRoles: [],
      },
    ]);

    await expect(
      service.login({
        email: 'mesero@resto.cl',
        password: 'Password123!',
        profileType: LoginProfileType.STAFF,
        restaurantSlug: 'mi-restaurante',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('logs in when the credentials belong to the restaurant matching the slug', async () => {
    signInWithPasswordMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: 'mesero@resto.cl',
    });
    restaurantFindUniqueMock.mockResolvedValue({ id: 'restaurant-target' });
    staffUserFindManyMock.mockResolvedValue([
      {
        id: 'staff-1',
        authUserId: 'auth-1',
        restaurantId: 'restaurant-target',
        firstName: 'Ana',
        lastName: 'Diaz',
        status: StaffUserStatus.ACTIVE,
        branchRoles: [],
      },
    ]);

    const result = await service.login({
      email: 'mesero@resto.cl',
      password: 'Password123!',
      profileType: LoginProfileType.STAFF,
      restaurantSlug: 'mi-restaurante',
    });

    expect(result.accessToken).toBe('signed-jwt');
    expect(result.expiresIn).toBe('8h');
    expect(result.expiresAt).toBe('2026-07-15T06:20:00.000Z');
    expect(result.user.restaurantId).toBe('restaurant-target');
  });

  it('logs in platform admin without needing a restaurant slug', async () => {
    signInWithPasswordMock.mockResolvedValue({
      authUserId: 'auth-admin',
      email: 'admin@sazono.cl',
    });
    platformAdminFindManyMock.mockResolvedValue([
      {
        id: 'platform-1',
        authUserId: 'auth-admin',
        firstName: 'Plat',
        lastName: 'Form',
        status: PlatformAdminStatus.ACTIVE,
      },
    ]);

    const result = await service.login({
      email: 'admin@sazono.cl',
      password: 'Password123!',
      profileType: LoginProfileType.PLATFORM_ADMIN,
    });

    expect(restaurantFindUniqueMock).not.toHaveBeenCalled();
    expect(result.user.profileType).toBe(LoginProfileType.PLATFORM_ADMIN);
    expect(result.expiresAt).toBe('2026-07-15T06:20:00.000Z');
  });
});
