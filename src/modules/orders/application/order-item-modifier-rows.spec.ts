import { Prisma } from '@prisma/client';
import { buildOrderItemModifierRows } from './order-item-modifier-rows';

describe('buildOrderItemModifierRows', () => {
  const modifier = (
    id: string,
    parent: string | null,
    depth: number,
    path: string[],
  ) => ({
    modifierOptionId: id,
    parentModifierOptionId: parent,
    depth,
    path,
    name: path[path.length - 1],
    priceDelta: new Prisma.Decimal(100),
  });

  it('links each row to its parent row and inserts parents first', () => {
    const rows = buildOrderItemModifierRows([
      modifier('duquesa', 'papas', 2, ['Papas', 'Duquesa']),
      modifier('papas', null, 1, ['Papas']),
    ]);

    expect(rows.map((r) => r.modifierOptionId)).toEqual(['papas', 'duquesa']);
    expect(rows[0].parentOrderItemModifierId).toBeNull();
    expect(rows[1].parentOrderItemModifierId).toBe(rows[0].id);
    expect(rows[1]).toMatchObject({
      depth: 2,
      pathSnapshot: ['Papas', 'Duquesa'],
      nameSnapshot: 'Duquesa',
    });
  });

  it('gives rows strictly increasing createdAt in selection order', () => {
    const rows = buildOrderItemModifierRows([
      modifier('papas', null, 1, ['Papas']),
      modifier('bebida', null, 1, ['Bebida']),
      modifier('duquesa', 'papas', 2, ['Papas', 'Duquesa']),
    ]);
    const times = rows.map((r) => r.createdAt.getTime());

    expect(rows.map((r) => r.modifierOptionId)).toEqual([
      'papas',
      'bebida',
      'duquesa',
    ]);
    expect(times[1]).toBeGreaterThan(times[0]);
    expect(times[2]).toBeGreaterThan(times[1]);
  });

  it('returns no rows for an empty selection', () => {
    expect(buildOrderItemModifierRows([])).toEqual([]);
  });
});
