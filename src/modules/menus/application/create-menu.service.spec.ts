import { MenuStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateMenuService } from './create-menu.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';

type TransactionClient = {
  menu: {
    findFirst: jest.Mock<Promise<null | { version: number }>, [unknown]>;
    create: jest.Mock<
      Promise<{
        id: string;
        branchId: string;
        name: string;
        status: MenuStatus;
        version: number;
        publishedAt: Date | null;
        defaultLanguage: string;
        categories: [];
      }>,
      [unknown]
    >;
  };
};

describe('CreateMenuService', () => {
  const transactionMock = jest.fn();
  const prisma = {
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const branchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  let service: CreateMenuService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateMenuService(prisma, branchAccessService);
  });

  it('creates a new draft menu with the next version number', async () => {
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      branchId: 'branch-1',
      restaurantId: 'restaurant-1',
    });

    const findFirstMock = jest
      .fn<Promise<null | { version: number }>, [unknown]>()
      .mockResolvedValue({
        version: 2,
      });
    const createMock = jest
      .fn<
        Promise<{
          id: string;
          branchId: string;
          name: string;
          status: MenuStatus;
          version: number;
          publishedAt: Date | null;
          defaultLanguage: string;
          categories: [];
        }>,
        [unknown]
      >()
      .mockResolvedValue({
        id: 'menu-3',
        branchId: 'branch-1',
        name: 'Carta invierno',
        status: MenuStatus.DRAFT,
        version: 3,
        publishedAt: null,
        defaultLanguage: 'es',
        categories: [],
      });

    transactionMock.mockImplementation(
      (callback: (transactionClient: TransactionClient) => Promise<unknown>) =>
        callback({
          menu: {
            findFirst: findFirstMock,
            create: createMock,
          },
        }),
    );

    const result = await service.execute(
      {
        sub: 'auth-1',
        profileType: LoginProfileType.STAFF,
        profileId: 'staff-1',
        restaurantId: 'restaurant-1',
      },
      {
        branchId: 'branch-1',
        name: 'Carta invierno',
        defaultLanguage: 'es',
      },
    );

    expect(result.version).toBe(3);
    expect(result.status).toBe(MenuStatus.DRAFT);
  });
});
