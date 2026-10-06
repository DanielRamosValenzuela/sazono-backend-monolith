import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import {
  STATION_TICKET_READY_EVENT,
  type StationTicketReadyEvent,
} from '../../kitchen/domain/station-ticket-events';
import { PushNotificationService } from './push-notification.service';

@Injectable()
export class StationTicketReadyListener {
  constructor(
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  @OnEvent(STATION_TICKET_READY_EVENT)
  async handle(event: StationTicketReadyEvent): Promise<void> {
    const payload = {
      title: 'Pedido listo',
      body: event.label
        ? `${event.label}: tu pedido esta listo para servir.`
        : 'Tu pedido esta listo para servir.',
      data: { orderId: event.orderId, type: STATION_TICKET_READY_EVENT },
    };

    if (event.isCounter && event.branchId) {
      await this.pushNotificationService.notifyBranchRoles(
        event.branchId,
        [Role.WAITER, Role.CASHIER],
        payload,
        event.openedByStaffUserId ? [event.openedByStaffUserId] : [],
      );
      return;
    }

    if (!event.createdByStaffUserId) {
      return;
    }

    await this.pushNotificationService.sendToStaffUsers(
      [event.createdByStaffUserId],
      payload,
    );
  }
}
