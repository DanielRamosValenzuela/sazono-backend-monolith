import { formatModifierLines } from './modifier-lines';

const row = (
  id: string,
  nameSnapshot: string,
  depth: number,
  parentOrderItemModifierId: string | null,
  pathSnapshot: string[],
) => ({ id, nameSnapshot, depth, parentOrderItemModifierId, pathSnapshot });

describe('formatModifierLines', () => {
  it('prints one line per leaf with the full path and skips intermediate nodes', () => {
    expect(
      formatModifierLines([
        row('bbq', 'Salsa BBQ', 1, null, ['Salsa BBQ']),
        row('papas', 'Papas', 1, null, ['Papas']),
        row('duquesa', 'Duquesa', 2, 'papas', ['Papas', 'Duquesa']),
      ]),
    ).toEqual(['Salsa BBQ', 'Papas > Duquesa']);
  });

  it('keeps a parent without a chosen sub-option and falls back to the name for old rows', () => {
    expect(
      formatModifierLines([
        row('a', 'Papas', 1, null, ['Papas']),
        row('b', 'Palta', 1, null, []),
      ]),
    ).toEqual(['Papas', 'Palta']);
  });
});
