import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  OrderItemStatus,
  OrderStatus,
  StationTicketStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { UpdateStationTicketStatusService } from './update-station-ticket-status.service';

describe('UpdateStationTicketStatusService', () => {
  const ticketFindUniqueMock = jest.fn();
  const ticketFindUniqueOrThrowMock = jest.fn();
  const transactionMock = jest.fn();
  const prisma = {
    stationTicket: {
      findUnique: ticketFindUniqueMock,
      findUniqueOrThrow: ticketFindUniqueOrThrowMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const ensureAccessMock = jest.fn();
  const BranchAccessService = {
    ensureAccess: ensureAccessMock,
  } as unknown as BranchAccessService;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  let service: UpdateStationTicketStatusService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdateStationTicketStatusService(
      prisma,
      BranchAccessService,
    );
  });

  const mappedTicket = {
    id: 'ticket-1',
    orderId: 'order-1',
    branchId: 'branch-1',
    preparationStationId: 'station-1',
    status: StationTicketStatus.READY,
    sentAt: null,
    startedAt: new Date('2026-07-07T12:00:00.000Z'),
    completedAt: new Date('2026-07-07T12:30:00.000Z'),
    preparationStation: {
      name: 'Cocina',
      stationType: 'KITCHEN',
    },
    order: {
      source: 'WAITER',
      notes: null,
      tableSession: {
        table: {
          code: 'M01',
        },
      },
    },
    stationTicketItems: [],
  };

  it('marks a ticket ready, syncs items and recomputes the order status', async () => {
    ticketFindUniqueMock.mockResolvedValue({
      id: 'ticket-1',
      orderId: 'order-1',
      branchId: 'branch-1',
      status: StationTicketStatus.IN_PROGRESS,
      startedAt: new Date('2026-07-07T12:00:00.000Z'),
      order: {
        id: 'order-1',
        status: OrderStatus.IN_PREPARATION,
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: ['KITCHEN'],
    });

    const ticketUpdateMock = jest.fn().mockResolvedValue({});
    const ticketItemsUpdateManyMock = jest.fn().mockResolvedValue({});
    const ticketItemsFindManyMock = jest
      .fn()
      .mockResolvedValue([{ orderItemId: 'order-item-1' }]);
    const orderItemUpdateManyMock = jest.fn().mockResolvedValue({});
    const orderTicketsFindManyMock = jest
      .fn()
      .mockResolvedValue([
        { status: StationTicketStatus.READY },
        { status: StationTicketStatus.IN_PROGRESS },
      ]);
    const orderUpdateMock = jest.fn().mockResolvedValue({});

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          stationTicket: {
            update: ticketUpdateMock,
            findMany: orderTicketsFindManyMock,
          },
          stationTicketItem: {
            updateMany: ticketItemsUpdateManyMock,
            findMany: ticketItemsFindManyMock,
          },
          orderItem: {
            updateMany: orderItemUpdateManyMock,
          },
          order: {
            update: orderUpdateMock,
          },
        }),
    );

    ticketFindUniqueOrThrowMock.mockResolvedValue(mappedTicket);

    const result = await service.execute(authUser, 'ticket-1', {
      status: StationTicketStatus.READY,
    });

    expect(result.status).toBe(StationTicketStatus.READY);

    expect(orderItemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderItemStatus.READY },
      }),
    );
    expect(orderUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderStatus.PARTIALLY_READY },
      }),
    );
  });

  it('rejects invalid transitions', async () => {
    ticketFindUniqueMock.mockResolvedValue({
      id: 'ticket-1',
      orderId: 'order-1',
      branchId: 'branch-1',
      status: StationTicketStatus.READY,
      startedAt: null,
      order: {
        id: 'order-1',
        status: OrderStatus.READY,
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: ['KITCHEN'],
    });

    await expect(
      service.execute(authUser, 'ticket-1', {
        status: StationTicketStatus.IN_PROGRESS,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('only allows supervisors or admins to cancel a ticket', async () => {
    ticketFindUniqueMock.mockResolvedValue({
      id: 'ticket-1',
      orderId: 'order-1',
      branchId: 'branch-1',
      status: StationTicketStatus.PENDING,
      startedAt: null,
      order: {
        id: 'order-1',
        status: OrderStatus.ROUTED,
      },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: ['KITCHEN'],
    });

    await expect(
      service.execute(authUser, 'ticket-1', {
        status: StationTicketStatus.CANCELLED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
