import { BadRequestException } from '@nestjs/common';
import { Role, TableSessionStatus, TableStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import { OpenTableSessionService } from './open-table-session.service';
import { GetCurrentTableSessionService } from './get-current-table-session.service';
import { SetTableZoneService } from './set-table-zone.service';
import { AssignTableSessionService } from './assign-table-session.service';
import { ListTablesService } from './list-tables.service';
import { ListTableZonesService } from './list-table-zones.service';
import { CreateTableService } from './create-table.service';

const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};
const ensureAccess = jest.fn().mockResolvedValue({
  staffUserId: 'staff-1',
  restaurantId: 'restaurant-1',
  branchId: 'branch-1',
  roles: [Role.ADMIN],
});
const access = { ensureAccess } as unknown as BranchAccessService;
const virtualTable = {
  id: 'table-v',
  branchId: 'branch-1',
  isVirtual: true,
  status: TableStatus.DISABLED,
};

describe('virtual (counter) table guards', () => {
  const tableFindUnique = jest.fn().mockResolvedValue(virtualTable);
  const sessionFindUnique = jest.fn();
  const tableFindMany = jest.fn().mockResolvedValue([]);
  const zoneFindMany = jest.fn().mockResolvedValue([]);
  const tableFindFirst = jest.fn();
  const prisma = {
    table: {
      findUnique: tableFindUnique,
      findMany: tableFindMany,
      findFirst: tableFindFirst,
    },
    tableSession: { findUnique: sessionFindUnique },
    tableZone: { findMany: zoneFindMany },
    branchSettings: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  it('open-table-session rejects the virtual table', async () => {
    await expect(
      new OpenTableSessionService(prisma, access).execute(authUser, {
        tableId: 'table-v',
        openedBySource: 'WAITER',
        guestCount: 1,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('get-current-table-session rejects the virtual table', async () => {
    await expect(
      new GetCurrentTableSessionService(prisma, access).execute(
        authUser,
        'table-v',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('set-table-zone rejects the virtual table', async () => {
    await expect(
      new SetTableZoneService(prisma, access).execute(authUser, 'table-v', {
        zoneId: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('assign rejects counter sessions', async () => {
    sessionFindUnique.mockResolvedValue({
      id: 's1',
      isCounter: true,
      status: TableSessionStatus.OPEN,
      branchId: 'branch-1',
    });
    await expect(
      new AssignTableSessionService(prisma, access).execute(authUser, 's1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list-tables and zones exclude virtual tables', async () => {
    await new ListTablesService(prisma, access).execute(authUser, {
      branchId: 'branch-1',
    });
    expect(
      (tableFindMany.mock.calls[0] as [{ where: object }])[0].where,
    ).toMatchObject({ isVirtual: false });

    await new ListTableZonesService(prisma, access).execute(authUser, {
      branchId: 'branch-1',
    });
    expect(
      (
        zoneFindMany.mock.calls[0] as [
          { include: { tables: { where: object } } },
        ]
      )[0].include.tables.where,
    ).toMatchObject({ isVirtual: false });
  });

  it('create-table rejects the reserved MOSTRADOR code case-insensitively', async () => {
    await expect(
      new CreateTableService(prisma, access).execute(authUser, {
        branchId: 'branch-1',
        code: ' mostrador ',
        name: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tableFindFirst).not.toHaveBeenCalled();
  });
});
