import { groupTranslationsByEntity, mapMenuDetail } from './menu-mapper';

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
