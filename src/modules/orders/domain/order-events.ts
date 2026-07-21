export const ORDER_CREATED_EVENT = 'order.created';

export interface OrderCreatedEvent {
  orderId: string;
  branchId: string;
}
