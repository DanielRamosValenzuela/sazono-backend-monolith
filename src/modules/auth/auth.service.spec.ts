import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
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
    expect(result.expiresAt).toBe('2026-07-14T09:00:00.000Z');
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
    expect(result.expiresAt).toBe('2026-07-14T09:00:00.000Z');
  });
});

describe('AuthService PIN login', () => {
  const getUserByIdMock = jest.fn();
  const authProvider = {
    getUserById: getUserByIdMock,
  } as unknown as AuthProvider;

  const staffUserFindUniqueMock = jest.fn();
  const staffUserUpdateMock = jest.fn().mockResolvedValue({});

  const prisma = {
    staffUser: {
      findUnique: staffUserFindUniqueMock,
      update: staffUserUpdateMock,
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

  const basePinHash = bcrypt.hashSync('1234', 10);
  const baseStaffUser = {
    id: 'staff-1',
    authUserId: 'auth-1',
    restaurantId: 'restaurant-1',
    firstName: 'Ana',
    lastName: 'Diaz',
    status: StaffUserStatus.ACTIVE,
    pinHash: basePinHash,
    pinFailedAttempts: 0,
    pinLockedUntil: null as Date | null,
    branchRoles: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    staffUserUpdateMock.mockResolvedValue({});
    signAsyncMock.mockResolvedValue('signed-jwt');
    decodeMock.mockReturnValue({ exp: 1_784_019_600 });
    getUserByIdMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: 'ana@resto.cl',
    });
    service = new AuthService(prisma, authProvider, jwtService, configService);
  });

  it('logs in with a correct PIN and resets the failed-attempts counter', async () => {
    staffUserFindUniqueMock.mockResolvedValue({ ...baseStaffUser });

    const result = await service.loginWithPin({
      staffUserId: 'staff-1',
      pin: '1234',
    });

    expect(result.accessToken).toBe('signed-jwt');
    expect(result.user.profileType).toBe(LoginProfileType.STAFF);
    expect(staffUserUpdateMock).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
  });

  it('rejects an incorrect PIN and increments the failed-attempts counter', async () => {
    staffUserFindUniqueMock.mockResolvedValue({
      ...baseStaffUser,
      pinFailedAttempts: 2,
    });

    await expect(
      service.loginWithPin({ staffUserId: 'staff-1', pin: '0000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(staffUserUpdateMock).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { pinFailedAttempts: 3 },
    });
  });

  it('locks the PIN after reaching the max failed attempts', async () => {
    staffUserFindUniqueMock.mockResolvedValue({
      ...baseStaffUser,
      pinFailedAttempts: 4,
    });

    await expect(
      service.loginWithPin({ staffUserId: 'staff-1', pin: '0000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const updateArgs = staffUserUpdateMock.mock.calls[0][0] as {
      data: { pinFailedAttempts: number; pinLockedUntil?: Date };
    };
    expect(updateArgs.data.pinFailedAttempts).toBe(0);
    expect(updateArgs.data.pinLockedUntil).toBeInstanceOf(Date);
  });

  it('rejects while the PIN is locked, without checking the PIN itself', async () => {
    staffUserFindUniqueMock.mockResolvedValue({
      ...baseStaffUser,
      pinLockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(
      service.loginWithPin({ staffUserId: 'staff-1', pin: '1234' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(staffUserUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects when the staff user has no PIN configured yet', async () => {
    staffUserFindUniqueMock.mockResolvedValue({
      ...baseStaffUser,
      pinHash: null,
    });

    await expect(
      service.loginWithPin({ staffUserId: 'staff-1', pin: '1234' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.setPin', () => {
  const prisma = {
    staffUser: {
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;

  const authProvider = {} as unknown as AuthProvider;
  const jwtService = {} as unknown as JwtService;
  const configService = {} as unknown as ConfigService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(prisma, authProvider, jwtService, configService);
  });

  it('rejects when the authenticated profile is not staff', async () => {
    await expect(
      service.setPin(
        {
          sub: 'auth-admin',
          profileType: LoginProfileType.PLATFORM_ADMIN,
          profileId: 'platform-1',
        },
        { pin: '1234' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hashes and stores the PIN for the authenticated staff profile', async () => {
    await service.setPin(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      { pin: '1234' },
    );

    const updateArgs = (prisma.staffUser.update as jest.Mock).mock
      .calls[0][0] as {
      where: { id: string };
      data: { pinHash: string };
    };
    expect(updateArgs.where).toEqual({ id: 'staff-1' });
    expect(bcrypt.compareSync('1234', updateArgs.data.pinHash)).toBe(true);
  });
});
