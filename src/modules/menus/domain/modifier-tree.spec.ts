import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isOptionEffectivelyAvailable,
  modifierGroupDepth,
  resolveModifierSelection,
  type ModifierTreeGroup,
  type ModifierTreeOption,
} from './modifier-tree';

const option = (
  id: string,
  delta: number,
  extra: Partial<ModifierTreeOption> = {},
): ModifierTreeOption => ({
  id,
  name: id,
  priceDelta: new Prisma.Decimal(delta),
  isAvailable: true,
  ...extra,
});

const group = (
  id: string,
  options: ModifierTreeOption[],
  extra: Partial<ModifierTreeGroup> = {},
): ModifierTreeGroup => ({
  id,
  name: id,
  minSelect: 0,
  maxSelect: null,
  isRequired: false,
  options,
  ...extra,
});

const tree = (): ModifierTreeGroup[] => [
  group(
    'side',
    [
      option('papas', 1500, {
        childGroups: [
          group(
            'papas-type',
            [
              option('fritas', 0),
              option('duquesa', 800, {
                childGroups: [
                  group('sauce', [option('mayo', 100), option('bbq', 300)], {
                    maxSelect: 1,
                  }),
                ],
              }),
            ],
            { isRequired: true, maxSelect: 1, selectionType: 'ONE' },
          ),
        ],
      }),
      option('ensalada', 0),
    ],
    { maxSelect: 2 },
  ),
  group('extras', [option('huevo', 500)]),
];

const papasType = (groups: ModifierTreeGroup[]) =>
  groups[0].options[0].childGroups![0];

const resolve = (ids: string[], groups = tree()) =>
  resolveModifierSelection(groups, ids, 'Hamburguesa');

describe('resolveModifierSelection', () => {
  it('builds the path, depth and parent of a three level selection, parents first', () => {
    const result = resolve(['mayo', 'duquesa', 'papas']);

    expect(
      result.map((entry) => [
        entry.option.id,
        entry.depth,
        entry.parentOptionId,
        entry.path,
      ]),
    ).toEqual([
      ['papas', 1, null, ['papas']],
      ['duquesa', 2, 'papas', ['papas', 'duquesa']],
      ['mayo', 3, 'duquesa', ['papas', 'duquesa', 'mayo']],
    ]);
  });

  it('sums the delta of every selected node', () => {
    const total = resolve(['papas', 'duquesa', 'bbq', 'huevo']).reduce(
      (sum, entry) => sum.add(entry.option.priceDelta),
      new Prisma.Decimal(0),
    );

    expect(total).toEqual(new Prisma.Decimal(3100));
  });

  it('accepts a flat selection and an empty one when nothing is required', () => {
    expect(resolve(['ensalada', 'huevo'])).toHaveLength(2);
    expect(resolve([])).toEqual([]);
  });

  it('requires the child group only when its parent option is selected', () => {
    expect(() => resolve(['papas'])).toThrow(
      'Debes seleccionar al menos 1 opcion(es) de "papas-type" (papas)',
    );
    expect(() => resolve(['ensalada'])).not.toThrow();
  });

  it('rejects a child option without its parent', () => {
    expect(() => resolve(['fritas'])).toThrow(
      'requiere seleccionar antes "papas"',
    );
    expect(() => resolve(['mayo', 'papas', 'fritas'])).toThrow(
      'requiere seleccionar antes "duquesa"',
    );
  });

  it('enforces max and single selection per level', () => {
    expect(() => resolve(['papas', 'fritas', 'duquesa'])).toThrow(
      'como maximo 1 opcion(es) de "papas-type" (papas)',
    );
    expect(() => resolve(['papas', 'duquesa', 'mayo', 'bbq'])).toThrow(
      'como maximo 1 opcion(es) de "sauce" (duquesa)',
    );
    expect(() =>
      resolve(['papas', 'fritas', 'ensalada', 'huevo']),
    ).not.toThrow();
  });

  it('rejects unknown, duplicated and unavailable options', () => {
    expect(() => resolve(['nope'])).toThrow(BadRequestException);
    expect(() => resolve(['huevo', 'huevo'])).toThrow('repetir');

    const groups = tree();
    groups[1].options[0].isAvailable = false;
    expect(() => resolve(['huevo'], groups)).toThrow('no esta disponible');
  });

  it('treats an option as unavailable when its required sub-group has no available options', () => {
    const groups = tree();
    papasType(groups).options.forEach((child) => {
      child.isAvailable = false;
    });

    expect(isOptionEffectivelyAvailable(groups[0].options[0])).toBe(false);
    expect(() => resolve(['papas'], groups)).toThrow('no esta disponible');
  });

  it('requires the available options of a required sub-group to reach its minimum', () => {
    const groups = tree();
    const sub = papasType(groups);
    sub.minSelect = 2;
    sub.maxSelect = 2;
    sub.options[1].isAvailable = false;

    expect(isOptionEffectivelyAvailable(groups[0].options[0])).toBe(false);

    sub.options[1].isAvailable = true;

    expect(isOptionEffectivelyAvailable(groups[0].options[0])).toBe(true);
  });

  it('keeps an option available when its empty sub-group is optional', () => {
    const groups = tree();
    papasType(groups).isRequired = false;
    papasType(groups).options.forEach((child) => {
      child.isAvailable = false;
    });

    expect(isOptionEffectivelyAvailable(groups[0].options[0])).toBe(true);
    expect(resolve(['papas'], groups)).toHaveLength(1);
  });

  it('rejects an unavailable parent even when its children are available', () => {
    const groups = tree();
    groups[0].options[0].isAvailable = false;

    expect(() => resolve(['papas', 'fritas'], groups)).toThrow(
      'no esta disponible',
    );
  });

  it('ignores levels deeper than the maximum depth', () => {
    const groups = tree();
    const sauce = papasType(groups).options[1].childGroups![0];
    sauce.options[0].childGroups = [group('g4', [option('too-deep', 0)])];

    expect(() =>
      resolve(['papas', 'duquesa', 'mayo', 'too-deep'], groups),
    ).toThrow('no pertenece al item');
  });
});

describe('modifierGroupDepth', () => {
  type Ancestry = Parameters<typeof modifierGroupDepth>[0];

  const chain = (levels: number): Ancestry => {
    let current: Ancestry = { id: 'g1' };

    for (let level = 2; level <= levels; level += 1) {
      current = { id: `g${level}`, parentOption: { modifierGroup: current } };
    }

    return current;
  };

  it('counts the groups up to the root', () => {
    expect(modifierGroupDepth(chain(1))).toBe(1);
    expect(modifierGroupDepth(chain(3))).toBe(3);
  });

  it('rejects a cycle', () => {
    const a: Ancestry = { id: 'a' };
    const b: Ancestry = { id: 'b', parentOption: { modifierGroup: a } };
    a.parentOption = { modifierGroup: b };

    expect(() => modifierGroupDepth(a)).toThrow(BadRequestException);
  });
});
