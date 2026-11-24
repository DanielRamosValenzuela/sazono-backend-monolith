import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Role } from '@prisma/client';
import {
  ORDER_CREATED_EVENT,
  type OrderCreatedEvent,
} from '../../orders/domain/order-events';
import { PushNotificationService } from './push-notification.service';

@Injectable()
export class OrderCreatedListener {
  private readonly logger = new Logger(OrderCreatedListener.name);

  constructor(
    private readonly pushNotificationService: PushNotificationService,
  ) {}

  @OnEvent(ORDER_CREATED_EVENT)
  async handle(event: OrderCreatedEvent): Promise<void> {
    try {
      await this.pushNotificationService.notifyBranchRoles(
        event.branchId,
        [Role.KITCHEN, Role.BAR],
        {
          title: 'Nueva orden',
          body: 'Hay una nueva orden en el salon.',
          data: { orderId: event.orderId, type: ORDER_CREATED_EVENT },
        },
      );
    } catch (error) {
      this.logger.error(
        `No se pudo notificar la orden ${event.orderId}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
