import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  OrderItemStatus,
  OrderStatus,
  StationTicketStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { AuditService } from '../../../common/audit/audit.service';
import type { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { STATION_TICKET_READY_EVENT } from '../domain/station-ticket-events';
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

  const emitMock = jest.fn();
  const eventEmitter = {
    emit: emitMock,
  } as unknown as EventEmitter2;

  const authUser = {
    sub: 'auth-1',
    profileType: LoginProfileType.STAFF,
    profileId: 'staff-1',
    restaurantId: 'restaurant-1',
  };

  const auditRecordMock = jest.fn();
  const auditService = {
    record: auditRecordMock,
  } as unknown as AuditService;

  let service: UpdateStationTicketStatusService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UpdateStationTicketStatusService(
      prisma,
      BranchAccessService,
      eventEmitter,
      auditService,
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
      createdByStaffUserId: 'staff-waiter-1',
      tableSession: {
        isCounter: false,
        ticketNumber: null,
        customerLabel: null,
        openedByStaffUserId: 'staff-opener-1',
        table: {
          code: 'M01',
        },
      },
    },
    stationTicketItems: [],
  };

  const arrangeReadyTransition = (
    orderTicketStatuses: StationTicketStatus[],
    orderStatus: OrderStatus,
  ) => {
    ticketFindUniqueMock.mockResolvedValue({
      id: 'ticket-1',
      orderId: 'order-1',
      branchId: 'branch-1',
      status: StationTicketStatus.IN_PROGRESS,
      startedAt: new Date('2026-07-07T12:00:00.000Z'),
      order: { id: 'order-1', status: orderStatus },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles: ['KITCHEN'],
    });
    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          stationTicket: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest
              .fn()
              .mockResolvedValue(
                orderTicketStatuses.map((status) => ({ status })),
              ),
          },
          stationTicketItem: {
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
          },
          orderItem: { updateMany: jest.fn().mockResolvedValue({}) },
          order: {
            update: jest.fn().mockResolvedValue({ status: orderStatus }),
          },
        }),
    );
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

    const ticketUpdateMock = jest.fn().mockResolvedValue({ count: 1 });
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
    const orderUpdateMock = jest
      .fn()
      .mockResolvedValue({ status: OrderStatus.IN_PREPARATION });

    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          stationTicket: {
            updateMany: ticketUpdateMock,
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
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('emits the ready event once the whole order rolls up to READY', async () => {
    arrangeReadyTransition(
      [StationTicketStatus.READY, StationTicketStatus.READY],
      OrderStatus.PARTIALLY_READY,
    );
    ticketFindUniqueOrThrowMock.mockResolvedValue(mappedTicket);

    await service.execute(authUser, 'ticket-1', {
      status: StationTicketStatus.READY,
    });

    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(STATION_TICKET_READY_EVENT, {
      orderId: 'order-1',
      createdByStaffUserId: 'staff-waiter-1',
      branchId: 'branch-1',
      label: 'M01',
      isCounter: false,
      openedByStaffUserId: 'staff-opener-1',
    });
  });

  it('labels counter orders with the ticket number and customer label', async () => {
    arrangeReadyTransition(
      [StationTicketStatus.READY],
      OrderStatus.IN_PREPARATION,
    );
    ticketFindUniqueOrThrowMock.mockResolvedValue({
      ...mappedTicket,
      order: {
        ...mappedTicket.order,
        tableSession: {
          ...mappedTicket.order.tableSession,
          isCounter: true,
          ticketNumber: 12,
          customerLabel: 'Ana',
          table: { code: 'MOSTRADOR' },
        },
      },
    });

    await service.execute(authUser, 'ticket-1', {
      status: StationTicketStatus.READY,
    });

    expect(emitMock).toHaveBeenCalledWith(STATION_TICKET_READY_EVENT, {
      orderId: 'order-1',
      createdByStaffUserId: 'staff-waiter-1',
      branchId: 'branch-1',
      label: '#12 Ana',
      isCounter: true,
      openedByStaffUserId: 'staff-opener-1',
    });
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
        status: StationTicketStatus.PENDING,
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

  const arrangeReturn = (
    from: StationTicketStatus,
    orderStatus: OrderStatus,
    roles: string[],
    orderTicketStatuses: StationTicketStatus[],
  ) => {
    ticketFindUniqueMock.mockResolvedValue({
      id: 'ticket-1',
      orderId: 'order-1',
      branchId: 'branch-1',
      status: from,
      startedAt: new Date('2026-07-07T12:00:00.000Z'),
      order: { id: 'order-1', status: orderStatus },
    });
    ensureAccessMock.mockResolvedValue({
      staffUserId: 'staff-1',
      restaurantId: 'restaurant-1',
      branchId: 'branch-1',
      roles,
    });
    const ticketUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const ticketFindUnique = jest.fn();
    const orderUpdate = jest.fn().mockResolvedValue({ status: orderStatus });
    const orderItemUpdateMany = jest.fn().mockResolvedValue({});
    transactionMock.mockImplementation(
      (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          stationTicket: {
            updateMany: ticketUpdate,
            findUnique: ticketFindUnique,
            findMany: jest
              .fn()
              .mockResolvedValue(
                orderTicketStatuses.map((status) => ({ status })),
              ),
          },
          stationTicketItem: {
            updateMany: jest.fn().mockResolvedValue({}),
            findMany: jest
              .fn()
              .mockResolvedValue([{ orderItemId: 'order-item-1' }]),
          },
          orderItem: { updateMany: orderItemUpdateMany },
          order: { update: orderUpdate },
        }),
    );
    ticketFindUniqueOrThrowMock.mockResolvedValue(mappedTicket);
    return { ticketUpdate, ticketFindUnique, orderUpdate, orderItemUpdateMany };
  };

  it('returns an in-progress ticket to pending for kitchen staff', async () => {
    const { ticketUpdate, orderItemUpdateMany } = arrangeReturn(
      StationTicketStatus.IN_PROGRESS,
      OrderStatus.IN_PREPARATION,
      ['KITCHEN'],
      [StationTicketStatus.PENDING],
    );

    await service.execute(authUser, 'ticket-1', {
      status: StationTicketStatus.PENDING,
    });

    expect(ticketUpdate).toHaveBeenCalledWith({
      where: { id: 'ticket-1', status: expect.any(String) },
      data: {
        status: StationTicketStatus.PENDING,
        startedAt: null,
        completedAt: null,
      },
    });
    expect(orderItemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: OrderItemStatus.PENDING } }),
    );
    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'STATION_TICKET_RETURNED',
        actorStaffUserId: 'staff-1',
        before: { status: StationTicketStatus.IN_PROGRESS },
        after: { status: StationTicketStatus.PENDING },
      }),
    );
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('returns a ready ticket to preparation and rolls the order back', async () => {
    const { ticketUpdate, orderUpdate, orderItemUpdateMany } = arrangeReturn(
      StationTicketStatus.READY,
      OrderStatus.READY,
      ['BAR'],
      [StationTicketStatus.IN_PROGRESS, StationTicketStatus.READY],
    );

    await service.execute(authUser, 'ticket-1', {
      status: StationTicketStatus.IN_PROGRESS,
    });

    expect(ticketUpdate).toHaveBeenCalledWith({
      where: { id: 'ticket-1', status: expect.any(String) },
      data: {
        status: StationTicketStatus.IN_PROGRESS,
        startedAt: new Date('2026-07-07T12:00:00.000Z'),
        completedAt: null,
      },
    });
    expect(orderItemUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderItemStatus.IN_PREPARATION },
      }),
    );
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: OrderStatus.PARTIALLY_READY },
      }),
    );
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('rejects returning a ticket once the order was delivered', async () => {
    arrangeReturn(
      StationTicketStatus.READY,
      OrderStatus.DELIVERED,
      ['ADMIN'],
      [StationTicketStatus.READY],
    );

    await expect(
      service.execute(authUser, 'ticket-1', {
        status: StationTicketStatus.IN_PROGRESS,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('audits a cancellation by an admin', async () => {
    arrangeReturn(
      StationTicketStatus.PENDING,
      OrderStatus.ROUTED,
      ['ADMIN'],
      [StationTicketStatus.CANCELLED],
    );

    await service.execute(authUser, 'ticket-1', {
      status: StationTicketStatus.CANCELLED,
    });

    expect(auditRecordMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'STATION_TICKET_CANCELLED',
        actorRole: 'ADMIN',
      }),
    );
  });

  it('does not allow cancelling a ready ticket', async () => {
    arrangeReturn(
      StationTicketStatus.READY,
      OrderStatus.READY,
      ['ADMIN'],
      [StationTicketStatus.READY],
    );

    await expect(
      service.execute(authUser, 'ticket-1', {
        status: StationTicketStatus.CANCELLED,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects with 409 when the ticket changed to a different status concurrently', async () => {
    const { ticketUpdate, ticketFindUnique, orderItemUpdateMany } =
      arrangeReturn(
        StationTicketStatus.IN_PROGRESS,
        OrderStatus.IN_PREPARATION,
        ['KITCHEN'],
        [StationTicketStatus.PENDING],
      );
    ticketUpdate.mockResolvedValue({ count: 0 });
    ticketFindUnique.mockResolvedValue({ status: StationTicketStatus.READY });

    await expect(
      service.execute(authUser, 'ticket-1', {
        status: StationTicketStatus.PENDING,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auditRecordMock).not.toHaveBeenCalled();
    expect(orderItemUpdateMany).not.toHaveBeenCalled();
  });

  it('treats a concurrent duplicate transition as an idempotent no-op', async () => {
    const { ticketUpdate, ticketFindUnique, orderUpdate, orderItemUpdateMany } =
      arrangeReturn(
        StationTicketStatus.IN_PROGRESS,
        OrderStatus.IN_PREPARATION,
        ['KITCHEN'],
        [StationTicketStatus.PENDING],
      );
    ticketUpdate.mockResolvedValue({ count: 0 });
    ticketFindUnique.mockResolvedValue({ status: StationTicketStatus.PENDING });

    await service.execute(authUser, 'ticket-1', {
      status: StationTicketStatus.PENDING,
    });

    expect(auditRecordMock).not.toHaveBeenCalled();
    expect(orderItemUpdateMany).not.toHaveBeenCalled();
    expect(orderUpdate).toHaveBeenCalledTimes(1);
    expect(emitMock).not.toHaveBeenCalled();
  });
});
