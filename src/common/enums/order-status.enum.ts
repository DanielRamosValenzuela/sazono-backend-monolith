export enum OrderStatus {
  DRAFT = 'draft',
  AWAITING_PAYMENT = 'awaiting_payment',
  PAYMENT_FAILED = 'payment_failed',
  CONFIRMED = 'confirmed',
  ROUTED = 'routed',
  IN_PREPARATION = 'in_preparation',
  PARTIALLY_READY = 'partially_ready',
  READY = 'ready',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}
