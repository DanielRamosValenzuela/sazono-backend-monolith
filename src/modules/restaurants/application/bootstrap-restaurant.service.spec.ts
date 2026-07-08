import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import { BootstrapRestaurantService } from './bootstrap-restaurant.service';

describe('BootstrapRestaurantService', () => {
  const createUserMock = jest.fn();
  const deleteUserMock = jest.fn();
  const authProvider = {
    createUser: createUserMock,
    deleteUser: deleteUserMock,
  } as unknown as AuthProvider;

  const transactionMock = jest.fn();
  const prisma = {
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const dto = {
    restaurant: {
      name: 'Belifest',
      legalName: 'Belifest SPA',
      defaultLanguage: 'es',
      timezone: 'America/Santiago',
      currency: 'CLP',
    },
    admin: {
      email: 'admin@belifest.cl',
      password: 'Password123!',
      firstName: 'Ada',
      lastName: 'Min',
    },
  };

  let service: BootstrapRestaurantService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BootstrapRestaurantService(prisma, authProvider);
  });

  it('creates the restaurant and its first admin', async () => {
    createUserMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: dto.admin.email,
    });
    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          restaurant: {
            create: jest.fn().mockResolvedValue({
              id: 'restaurant-1',
              name: dto.restaurant.name,
            }),
          },
          staffUser: {
            create: jest.fn().mockResolvedValue({
              id: 'staff-1',
              firstName: dto.admin.firstName,
              lastName: dto.admin.lastName,
            }),
          },
        }),
    );

    const result = await service.execute(dto);

    expect(result.restaurantId).toBe('restaurant-1');
    expect(result.firstAdmin.authUserId).toBe('auth-1');
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('maps a duplicate-email AuthError to a 409 ConflictException instead of a raw 500', async () => {
    createUserMock.mockRejectedValue({
      status: 422,
      code: 'email_exists',
      message: 'A user with this email address has already been registered',
    });

    await expect(service.execute(dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transactionMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('rejects with the original error for a non-duplicate Supabase failure', async () => {
    const genericError = new Error('network unreachable');
    createUserMock.mockRejectedValue(genericError);

    await expect(service.execute(dto)).rejects.toBe(genericError);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('deletes the just-created auth identity if the Prisma transaction fails', async () => {
    createUserMock.mockResolvedValue({
      authUserId: 'auth-1',
      email: dto.admin.email,
    });
    const dbError = new Error('unique constraint violation');
    transactionMock.mockRejectedValue(dbError);

    await expect(service.execute(dto)).rejects.toBe(dbError);
    expect(deleteUserMock).toHaveBeenCalledWith('auth-1');
  });
});
