import {
  collectModifierWarnings,
  groupTranslationsByEntity,
  mapMenuDetail,
  mapModifierGroup,
} from './menu-mapper';

describe('mapMenuDetail', () => {
  const baseMenu = {
    id: 'menu-1',
    branchId: 'branch-1',
    name: 'Carta',
    status: 'PUBLISHED' as const,
    version: 1,
    publishedAt: null,
    defaultLanguage: 'es',
  };
  const category = (
    id: string,
    parentId: string | null,
    sortOrder: number,
  ) => ({
    id,
    name: id,
    sortOrder,
    status: 'ACTIVE' as const,
    parentId,
    items: [],
  });

  it('keeps categories as a flat array and exposes parentId with the existing fields', () => {
    const detail = mapMenuDetail(
      {
        ...baseMenu,
        categories: [
          category('cafe', null, 0),
          category('calientes', 'cafe', 1),
          category('latte', 'calientes', 2),
        ],
      },
      false,
    );

    expect(detail.categories).toHaveLength(3);
    expect(
      detail.categories.map((c) => ({
        menuCategoryId: c.menuCategoryId,
        parentId: c.parentId,
        sortOrder: c.sortOrder,
        name: c.name,
        status: c.status,
      })),
    ).toEqual([
      {
        menuCategoryId: 'cafe',
        parentId: null,
        sortOrder: 0,
        name: 'cafe',
        status: 'ACTIVE',
      },
      {
        menuCategoryId: 'calientes',
        parentId: 'cafe',
        sortOrder: 1,
        name: 'calientes',
        status: 'ACTIVE',
      },
      {
        menuCategoryId: 'latte',
        parentId: 'calientes',
        sortOrder: 2,
        name: 'latte',
        status: 'ACTIVE',
      },
    ]);
    expect(Object.keys(detail.categories[0]).sort()).toEqual([
      'items',
      'menuCategoryId',
      'name',
      'parentId',
      'sortOrder',
      'status',
      'translations',
    ]);
  });
});

describe('groupTranslationsByEntity', () => {
  it('merges name and description rows for the same entity and locale', () => {
    const result = groupTranslationsByEntity([
      {
        entityId: 'item-1',
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Pisco Sour',
      },
      {
        entityId: 'item-1',
        locale: 'en',
        fieldName: 'description',
        translatedValue: 'Pisco, lime and syrup.',
      },
    ]);

    expect(result.get('item-1')).toEqual([
      {
        locale: 'en',
        name: 'Pisco Sour',
        description: 'Pisco, lime and syrup.',
      },
    ]);
  });

  it('keeps separate entries per locale for the same entity', () => {
    const result = groupTranslationsByEntity([
      {
        entityId: 'cat-1',
        locale: 'en',
        fieldName: 'name',
        translatedValue: 'Mains',
      },
      {
        entityId: 'cat-1',
        locale: 'fr',
        fieldName: 'name',
        translatedValue: 'Plats',
      },
    ]);

    expect(result.get('cat-1')).toHaveLength(2);
    expect(result.get('cat-1')).toEqual(
      expect.arrayContaining([
        { locale: 'en', name: 'Mains', description: null },
        { locale: 'fr', name: 'Plats', description: null },
      ]),
    );
  });

  it('drops entries with no translated name (description-only rows are incomplete)', () => {
    const result = groupTranslationsByEntity([
      {
        entityId: 'item-1',
        locale: 'en',
        fieldName: 'description',
        translatedValue: 'Only a description',
      },
    ]);

    expect(result.get('item-1')).toEqual([]);
  });

  it('returns an empty array for entities with no translations', () => {
    const result = groupTranslationsByEntity([]);

    expect(result.get('missing-entity')).toBeUndefined();
  });
});

type TestGroup = Parameters<typeof mapModifierGroup>[0];
type TestOption = TestGroup['options'][number];

describe('mapModifierGroup nested options', () => {
  const opt = (
    id: string,
    isAvailable: boolean,
    childGroups: TestGroup[] = [],
  ): TestOption => ({
    id,
    name: id,
    priceDelta: { toString: () => '100' },
    isAvailable,
    sortOrder: 0,
    imageUrl: null,
    childGroups,
  });
  const grp = (
    id: string,
    options: TestOption[],
    isRequired = false,
  ): TestGroup => ({
    id,
    branchId: 'branch-1',
    parentOptionId: null,
    name: id,
    selectionType: 'ONE' as const,
    minSelect: 0,
    maxSelect: 1,
    isRequired,
    sortOrder: 0,
    options,
  });

  it('maps the tree with depth and keeps the raw flag in the admin view', () => {
    const root = grp('root', [
      opt('papas', true, [grp('type', [opt('duquesa', false)], true)]),
    ]);

    const admin = mapModifierGroup(root);

    expect(admin.depth).toBe(1);
    expect(admin.options[0].childGroups[0].depth).toBe(2);
    expect(admin.options[0].isAvailable).toBe(true);
  });

  it('hides unavailable options and marks parents with an empty required sub-group as unavailable in the public view', () => {
    const root = grp('root', [
      opt('papas', true, [grp('type', [opt('duquesa', false)], true)]),
      opt('ensalada', false, [grp('x', [opt('y', true)])]),
    ]);

    const pub = mapModifierGroup(root, 1, true);

    expect(pub.options[0].isAvailable).toBe(false);
    expect(pub.options[1].isAvailable).toBe(false);
    expect(pub.options[1].childGroups).toEqual([]);
  });
});

describe('collectModifierWarnings', () => {
  const option = (
    id: string,
    isAvailable: boolean,
    childGroups: TestGroup[] = [],
  ): TestOption => ({
    id,
    name: id,
    priceDelta: { toString: () => '0' },
    isAvailable,
    sortOrder: 0,
    imageUrl: null,
    childGroups,
  });
  const group = (
    id: string,
    options: TestOption[],
    isRequired = true,
  ): TestGroup => ({
    id,
    branchId: 'b',
    name: id,
    selectionType: 'ONE',
    minSelect: 0,
    maxSelect: 1,
    isRequired,
    sortOrder: 0,
    options,
  });

  it('warns for available options whose required sub-group cannot be satisfied', () => {
    const root = group('root', [
      option('papas', true, [group('tipo', [option('x', false)])]),
      option('ensalada', true, [group('extra', [option('y', false)], false)]),
      option('off', false, [group('g', [option('z', false)])]),
    ]);

    expect(collectModifierWarnings([root, root])).toEqual([
      {
        code: 'OPTION_REQUIRED_SUBGROUP_UNAVAILABLE',
        optionName: 'papas',
        groupName: 'tipo',
      },
    ]);
  });
});
