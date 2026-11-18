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
  const executeRawMock = jest.fn().mockResolvedValue(1);

  const prisma = {
    staffUser: {
      findUnique: staffUserFindUniqueMock,
      update: staffUserUpdateMock,
    },
    $executeRaw: executeRawMock,
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
    approvalPinFailedAttempts: 0,
    approvalPinLockedUntil: null as Date | null,
    branchRoles: [],
  };

  const sqlText = (call: unknown[]) =>
    (call[0] as { strings: string[] }).strings.join('?');

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

  it('rejects an incorrect PIN with one atomic increment statement', async () => {
    staffUserFindUniqueMock.mockResolvedValue({
      ...baseStaffUser,
      pinFailedAttempts: 2,
    });

    await expect(
      service.loginWithPin({ staffUserId: 'staff-1', pin: '0000' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const sql = sqlText(executeRawMock.mock.calls[0] as unknown[]);
    expect(sql).toContain('UPDATE staff_users SET');
    expect(sql).toContain('pin_failed_attempts + 1');
    expect(sql).not.toContain('approval_pin');
    expect(staffUserUpdateMock).not.toHaveBeenCalled();
  });

  it('emits one incremental statement per failure regardless of the value read', async () => {
    staffUserFindUniqueMock.mockResolvedValue({
      ...baseStaffUser,
      pinFailedAttempts: 4,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(
        service.loginWithPin({ staffUserId: 'staff-1', pin: '0000' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    expect(executeRawMock).toHaveBeenCalledTimes(3);
    for (const call of executeRawMock.mock.calls) {
      expect(sqlText(call as unknown[])).toContain('pin_failed_attempts + 1');
    }
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
    expect(executeRawMock).not.toHaveBeenCalled();
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

describe('AuthService.verifyStaffPin', () => {
  const staffUserUpdateMock = jest.fn().mockResolvedValue({});
  const executeRawMock = jest.fn().mockResolvedValue(1);
  const prisma = {
    staffUser: { update: staffUserUpdateMock },
    $executeRaw: executeRawMock,
  } as unknown as PrismaService;
  const service = new AuthService(
    prisma,
    {} as unknown as AuthProvider,
    {} as unknown as JwtService,
    {} as unknown as ConfigService,
  );
  const subject = {
    id: 'staff-1',
    pinHash: bcrypt.hashSync('1234', 10),
    pinFailedAttempts: 0,
    pinLockedUntil: null as Date | null,
    approvalPinFailedAttempts: 0,
    approvalPinLockedUntil: null as Date | null,
  };
  const sqlText = (call: unknown[]) =>
    (call[0] as { strings: string[] }).strings.join('?');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resets only the approval counters on a correct approval PIN', async () => {
    await expect(
      service.verifyStaffPin(subject, '1234', 'APPROVAL'),
    ).resolves.toBe('OK');

    expect(staffUserUpdateMock).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { approvalPinFailedAttempts: 0, approvalPinLockedUntil: null },
    });
  });

  it('resets only the login counters on a correct login PIN', async () => {
    await expect(
      service.verifyStaffPin(subject, '1234', 'LOGIN'),
    ).resolves.toBe('OK');

    expect(staffUserUpdateMock).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });
  });

  it('counts a wrong approval PIN on the approval columns only', async () => {
    await expect(
      service.verifyStaffPin(subject, '0000', 'APPROVAL'),
    ).resolves.toBe('INVALID');

    const sql = sqlText(executeRawMock.mock.calls[0] as unknown[]);
    expect(sql).toContain('approval_pin_failed_attempts + 1');
    expect(sql).toContain('approval_pin_locked_until');
    expect(sql).not.toMatch(/(?<!approval_)pin_failed_attempts/);
  });

  it('issues N increments for N parallel failures that read the same state', async () => {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        service.verifyStaffPin(subject, '0000', 'APPROVAL'),
      ),
    );

    expect(executeRawMock).toHaveBeenCalledTimes(4);
  });

  it('is locked per scope without comparing the PIN', async () => {
    const future = new Date(Date.now() + 60_000);

    await expect(
      service.verifyStaffPin(
        { ...subject, approvalPinLockedUntil: future },
        '1234',
        'APPROVAL',
      ),
    ).resolves.toBe('LOCKED');
    await expect(
      service.verifyStaffPin(
        { ...subject, approvalPinLockedUntil: future },
        '1234',
        'LOGIN',
      ),
    ).resolves.toBe('OK');
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    expect(sqlText(executeRawMock.mock.calls[0] as unknown[])).not.toContain(
      'approval_pin',
    );
  });

  it('reserves the attempt atomically and refuses when the database row is already locked', async () => {
    executeRawMock.mockResolvedValueOnce(0);

    await expect(
      service.verifyStaffPin(subject, '1234', 'APPROVAL'),
    ).resolves.toBe('LOCKED');

    const sql = sqlText(executeRawMock.mock.calls[0] as unknown[]);
    expect(sql).toContain(
      'approval_pin_locked_until IS NULL OR approval_pin_locked_until <= now()',
    );
    expect(staffUserUpdateMock).not.toHaveBeenCalled();
  });

  it('tests at most the allowed attempts when a burst reads the same stale state', async () => {
    let remaining = 5;
    executeRawMock.mockImplementation(() => {
      if (remaining === 0) {
        return Promise.resolve(0);
      }

      remaining -= 1;
      return Promise.resolve(1);
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        service.verifyStaffPin(subject, '0000', 'APPROVAL'),
      ),
    );

    expect(results.filter((result) => result === 'INVALID')).toHaveLength(5);
    expect(results.filter((result) => result === 'LOCKED')).toHaveLength(15);
    executeRawMock.mockResolvedValue(1);
  });

  it('is invalid when the user has no PIN', async () => {
    await expect(
      service.verifyStaffPin({ ...subject, pinHash: null }, '1234', 'APPROVAL'),
    ).resolves.toBe('INVALID');
    expect(executeRawMock).not.toHaveBeenCalled();
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

describe('AuthService concurrent lookups', () => {
  const signInWithPasswordMock = jest.fn();
  const getUserByIdMock = jest.fn();
  const authProvider = {
    signInWithPassword: signInWithPasswordMock,
    getUserById: getUserByIdMock,
  } as unknown as AuthProvider;

  const restaurantFindUniqueMock = jest.fn();
  const platformAdminFindManyMock = jest.fn();
  const staffUserFindManyMock = jest.fn();

  const prisma = {
    restaurant: { findUnique: restaurantFindUniqueMock },
    platformAdmin: { findMany: platformAdminFindManyMock },
    staffUser: { findMany: staffUserFindManyMock },
  } as unknown as PrismaService;

  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('signed-jwt'),
    decode: jest.fn().mockReturnValue({ exp: 1_784_019_600 }),
  } as unknown as JwtService;
  const configService = {
    get: jest.fn().mockReturnValue('8h'),
  } as unknown as ConfigService;

  const staffUser = {
    id: 'staff-1',
    authUserId: 'auth-1',
    restaurantId: 'restaurant-1',
    firstName: 'Ana',
    lastName: 'Diaz',
    status: StaffUserStatus.ACTIVE,
    branchRoles: [],
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    platformAdminFindManyMock.mockResolvedValue([]);
    staffUserFindManyMock.mockResolvedValue([staffUser]);
    service = new AuthService(prisma, authProvider, jwtService, configService);
  });

  it('looks up the restaurant slug while the sign in is still pending', async () => {
    let resolveSignIn: (value: unknown) => void = () => undefined;
    signInWithPasswordMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    restaurantFindUniqueMock.mockResolvedValue({ id: 'restaurant-1' });

    const pending = service.login({
      email: 'ana@resto.cl',
      password: 'Password123!',
      restaurantSlug: 'resto',
      profileType: LoginProfileType.STAFF,
    });

    await Promise.resolve();
    expect(restaurantFindUniqueMock).toHaveBeenCalledTimes(1);

    resolveSignIn({ authUserId: 'auth-1', email: 'ana@resto.cl' });
    const result = await pending;

    expect(result.user.profileId).toBe('staff-1');
  });

  it('rejects invalid credentials even when the slug lookup succeeds', async () => {
    signInWithPasswordMock.mockResolvedValue(null);
    restaurantFindUniqueMock.mockResolvedValue({ id: 'restaurant-1' });

    await expect(
      service.login({
        email: 'ana@resto.cl',
        password: 'bad',
        restaurantSlug: 'resto',
        profileType: LoginProfileType.STAFF,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('loads the profile records while the identity lookup is pending', async () => {
    let resolveIdentity: (value: unknown) => void = () => undefined;
    getUserByIdMock.mockReturnValue(
      new Promise((resolve) => {
        resolveIdentity = resolve;
      }),
    );

    const pending = service.getCurrentUser({
      sub: 'auth-1',
      profileType: LoginProfileType.STAFF,
      profileId: 'staff-1',
      restaurantId: 'restaurant-1',
    });

    await Promise.resolve();
    expect(staffUserFindManyMock).toHaveBeenCalledTimes(1);
    expect(platformAdminFindManyMock).toHaveBeenCalledTimes(1);

    resolveIdentity({ authUserId: 'auth-1', email: 'ana@resto.cl' });
    const profile = await pending;

    expect(profile.email).toBe('ana@resto.cl');
    expect(profile.profileId).toBe('staff-1');
  });

  it('rejects the session when the identity no longer exists', async () => {
    getUserByIdMock.mockResolvedValue(null);

    await expect(
      service.getCurrentUser({
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
