import { randomUUID } from 'node:crypto';
import type { OrderableModifier } from './orderable-menu-item-resolver.service';

export const buildOrderItemModifierRows = (modifiers: OrderableModifier[]) => {
  const idByOptionId = new Map(
    modifiers.map((modifier) => [modifier.modifierOptionId, randomUUID()]),
  );

  const baseTime = Date.now();

  return [...modifiers]
    .sort((left, right) => left.depth - right.depth)
    .map((modifier, index) => ({
      id: idByOptionId.get(modifier.modifierOptionId) as string,
      modifierOptionId: modifier.modifierOptionId,
      parentOrderItemModifierId: modifier.parentModifierOptionId
        ? (idByOptionId.get(modifier.parentModifierOptionId) ?? null)
        : null,
      depth: modifier.depth,
      pathSnapshot: modifier.path,
      nameSnapshot: modifier.name,
      priceDeltaSnapshot: modifier.priceDelta,
      createdAt: new Date(baseTime + index),
    }));
};
