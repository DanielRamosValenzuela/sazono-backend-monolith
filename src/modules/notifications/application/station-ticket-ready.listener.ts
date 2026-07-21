import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
    if (!event.createdByStaffUserId) {
      return;
    }

    await this.pushNotificationService.sendToStaffUsers(
      [event.createdByStaffUserId],
      {
        title: 'Pedido listo',
        body: 'Tu pedido esta listo para servir.',
        data: { orderId: event.orderId, type: STATION_TICKET_READY_EVENT },
      },
    );
  }
}
