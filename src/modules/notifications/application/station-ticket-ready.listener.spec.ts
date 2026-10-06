import { Role } from '@prisma/client';
import { STATION_TICKET_READY_EVENT } from '../../kitchen/domain/station-ticket-events';
import { StationTicketReadyListener } from './station-ticket-ready.listener';
import type { PushNotificationService } from './push-notification.service';

describe('StationTicketReadyListener', () => {
  const sendToStaffUsersMock = jest.fn();
  const notifyBranchRolesMock = jest.fn();
  const listener = new StationTicketReadyListener({
    sendToStaffUsers: sendToStaffUsersMock,
    notifyBranchRoles: notifyBranchRolesMock,
  } as unknown as PushNotificationService);

  beforeEach(() => jest.clearAllMocks());

  it('notifies only the order creator for table orders, with the table code', async () => {
    await listener.handle({
      orderId: 'order-1',
      createdByStaffUserId: 'staff-1',
      branchId: 'branch-1',
      label: 'M01',
      isCounter: false,
      openedByStaffUserId: 'staff-2',
    });

    expect(sendToStaffUsersMock).toHaveBeenCalledWith(['staff-1'], {
      title: 'Pedido listo',
      body: 'M01: tu pedido esta listo para servir.',
      data: { orderId: 'order-1', type: STATION_TICKET_READY_EVENT },
    });
    expect(notifyBranchRolesMock).not.toHaveBeenCalled();
  });

  it('notifies the opener plus branch waiters and cashiers for counter orders', async () => {
    await listener.handle({
      orderId: 'order-1',
      createdByStaffUserId: 'staff-1',
      branchId: 'branch-1',
      label: '#12 Ana',
      isCounter: true,
      openedByStaffUserId: 'staff-2',
    });

    expect(notifyBranchRolesMock).toHaveBeenCalledWith(
      'branch-1',
      [Role.WAITER, Role.CASHIER],
      {
        title: 'Pedido listo',
        body: '#12 Ana: tu pedido esta listo para servir.',
        data: { orderId: 'order-1', type: STATION_TICKET_READY_EVENT },
      },
      ['staff-2'],
    );
    expect(sendToStaffUsersMock).not.toHaveBeenCalled();
  });

  it('keeps the legacy body when the event carries no label', async () => {
    await listener.handle({
      orderId: 'order-1',
      createdByStaffUserId: 'staff-1',
    });

    expect(sendToStaffUsersMock).toHaveBeenCalledWith(
      ['staff-1'],
      expect.objectContaining({ body: 'Tu pedido esta listo para servir.' }),
    );
  });

  it('does nothing for table orders without a creator', async () => {
    await listener.handle({ orderId: 'order-1', createdByStaffUserId: null });

    expect(sendToStaffUsersMock).not.toHaveBeenCalled();
  });
});
