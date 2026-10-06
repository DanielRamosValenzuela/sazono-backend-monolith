import { OrderStatus } from '@prisma/client';

export type CounterReadiness =
  'EMPTY' | 'WAITING' | 'PREPARING' | 'PARTIALLY_READY' | 'READY' | 'DELIVERED';

export function rollupCounterReadiness(
  statuses: OrderStatus[],
): CounterReadiness {
  const live = statuses.filter((status) => status !== OrderStatus.CANCELLED);

  if (live.length === 0) {
    return 'EMPTY';
  }

  if (live.every((status) => status === OrderStatus.DELIVERED)) {
    return 'DELIVERED';
  }

  const isReadyish = (status: OrderStatus) =>
    status === OrderStatus.READY || status === OrderStatus.DELIVERED;

  if (
    live.every(isReadyish) &&
    live.some((status) => status === OrderStatus.READY)
  ) {
    return 'READY';
  }

  if (
    live.some(
      (status) =>
        status === OrderStatus.READY || status === OrderStatus.PARTIALLY_READY,
    )
  ) {
    return 'PARTIALLY_READY';
  }

  if (live.some((status) => status === OrderStatus.IN_PREPARATION)) {
    return 'PREPARING';
  }

  return 'WAITING';
}
