import { BadRequestException } from '@nestjs/common';
import { MenuCategoryStatus } from '@prisma/client';
import {
  assertValidCategoryParent,
  categoryPathOf,
  hasPublishableContent,
  keepReachableCategories,
} from './menu-category-tree';

const flat = [
  { id: 'cafe', parentId: null },
  { id: 'calientes', parentId: 'cafe' },
  { id: 'latte', parentId: 'calientes' },
  { id: 'postres', parentId: null },
];

describe('assertValidCategoryParent', () => {
  it('accepts a new category under a root or second-level parent', () => {
    expect(() => assertValidCategoryParent(flat, 'cafe', null)).not.toThrow();
    expect(() =>
      assertValidCategoryParent(flat, 'calientes', null),
    ).not.toThrow();
  });

  it('rejects a fourth level', () => {
    expect(() => assertValidCategoryParent(flat, 'latte', null)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a parent that is not part of the menu', () => {
    expect(() => assertValidCategoryParent(flat, 'foreign', null)).toThrow(
      'no existe en esta carta',
    );
  });

  it('rejects a category as its own parent', () => {
    expect(() => assertValidCategoryParent(flat, 'cafe', 'cafe')).toThrow(
      BadRequestException,
    );
  });

  it('rejects moving a category under its own descendant', () => {
    expect(() => assertValidCategoryParent(flat, 'latte', 'cafe')).toThrow(
      BadRequestException,
    );
    expect(() => assertValidCategoryParent(flat, 'calientes', 'cafe')).toThrow(
      BadRequestException,
    );
  });

  it('accounts for the height of the moved subtree', () => {
    expect(() => assertValidCategoryParent(flat, 'postres', 'cafe')).toThrow(
      '3 niveles',
    );
    expect(() =>
      assertValidCategoryParent(flat, 'postres', 'calientes'),
    ).not.toThrow();
  });

  it('lets a leaf move between valid parents', () => {
    expect(() =>
      assertValidCategoryParent(flat, 'postres', 'latte'),
    ).not.toThrow();
  });

  it('does not loop forever on corrupted data', () => {
    const corrupted = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];

    expect(() => assertValidCategoryParent(corrupted, 'a', null)).toThrow(
      BadRequestException,
    );
  });
});

describe('keepReachableCategories', () => {
  it('drops categories whose ancestor is missing, at any depth', () => {
    const kept = keepReachableCategories([
      { id: 'child', parentId: 'parent' },
      { id: 'grandchild', parentId: 'child' },
      { id: 'root', parentId: null },
    ]);

    expect(kept.map((category) => category.id)).toEqual(['root']);
  });
});

describe('hasPublishableContent', () => {
  const active = MenuCategoryStatus.ACTIVE;

  it('counts a parent with only subcategories when a descendant has items', () => {
    expect(
      hasPublishableContent([
        { id: 'p', parentId: null, status: active, items: [] },
        { id: 'c', parentId: 'p', status: active, items: [1] },
      ]),
    ).toBe(true);
  });

  it('ignores items under an inactive ancestor', () => {
    expect(
      hasPublishableContent([
        {
          id: 'p',
          parentId: null,
          status: MenuCategoryStatus.HIDDEN,
          items: [],
        },
        { id: 'c', parentId: 'p', status: active, items: [1] },
      ]),
    ).toBe(false);
  });

  it('is false when no category has items', () => {
    expect(
      hasPublishableContent([
        { id: 'p', parentId: null, status: active, items: [] },
      ]),
    ).toBe(false);
  });
});

describe('categoryPathOf', () => {
  it('lists names from root to the category', () => {
    expect(
      categoryPathOf({
        name: 'Latte',
        parent: { name: 'Bebidas Calientes', parent: { name: 'Cafe' } },
      }),
    ).toEqual(['Cafe', 'Bebidas Calientes', 'Latte']);
    expect(categoryPathOf({ name: 'Postres', parent: null })).toEqual([
      'Postres',
    ]);
  });
});
