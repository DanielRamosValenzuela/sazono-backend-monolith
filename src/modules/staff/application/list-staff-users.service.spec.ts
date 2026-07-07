import { Role, StaffUserStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import { ListStaffUsersService } from './list-staff-users.service';
import { StaffAdminAccessService } from './staff-admin-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

describe('ListStaffUsersService', () => {
  const findManyMock = jest.fn();
  const prisma = {
    staffUser: {
      findMany: findManyMock,
    },
  } as unknown as PrismaService;

  const getAdminContextMock = jest.fn();
  const staffAdminAccessService = {
    getAdminContext: getAdminContextMock,
  } as unknown as StaffAdminAccessService;

  const getUserByIdMock = jest.fn();
  const authProvider = {
    getUserById: getUserByIdMock,
  } as unknown as AuthProvider;

  let service: ListStaffUsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ListStaffUsersService(
      prisma,
      staffAdminAccessService,
      authProvider,
    );
  });

  it('returns restaurant staff with active branch roles', async () => {
    getAdminContextMock.mockResolvedValue({
      staffUserId: 'staff-admin-1',
      restaurantId: 'restaurant-1',
      adminBranchIds: new Set(['branch-1']),
    });
    findManyMock.mockResolvedValue([
      {
        id: 'staff-1',
        authUserId: 'auth-1',
        restaurantId: 'restaurant-1',
        firstName: 'Ana',
        lastName: 'Diaz',
        status: StaffUserStatus.ACTIVE,
        branchRoles: [
          {
            branchId: 'branch-1',
            role: Role.WAITER,
            branch: {
              id: 'branch-1',
              name: 'Providencia',
            },
          },
        ],
      },
    ]);
    getUserByIdMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: 'ana@sazonodemo.cl',
    });

    const result = await service.execute({
      sub: 'auth-admin',
      profileType: LoginProfileType.STAFF,
      profileId: 'staff-admin-1',
      restaurantId: 'restaurant-1',
    });

    expect(result).toEqual([
      {
        staffUserId: 'staff-1',
        authUserId: 'auth-1',
        restaurantId: 'restaurant-1',
        email: 'ana@sazonodemo.cl',
        firstName: 'Ana',
        lastName: 'Diaz',
        status: StaffUserStatus.ACTIVE,
        branchRoles: [
          {
            branchId: 'branch-1',
            branchName: 'Providencia',
            role: Role.WAITER,
          },
        ],
      },
    ]);
  });
});
