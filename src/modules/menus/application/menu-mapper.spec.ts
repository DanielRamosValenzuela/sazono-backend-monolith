import { groupTranslationsByEntity } from './menu-mapper';

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
