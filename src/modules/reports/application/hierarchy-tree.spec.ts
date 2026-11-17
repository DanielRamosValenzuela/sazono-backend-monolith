import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildBreadcrumb,
  buildHierarchyView,
  computeShare,
  decodeCategoryNodeId,
  decodeNodeId,
  encodeNodeId,
  normalizePath,
  pathStartsWith,
  type HierarchyLine,
} from './hierarchy-tree';

function line(
  path: string[],
  itemName: string,
  amount: number,
  quantity: number,
  extra: Partial<HierarchyLine> = {},
): HierarchyLine {
  return {
    path,
    itemName,
    stationName: 'Barra',
    amount,
    quantity,
    cancelledQuantity: 0,
    ...extra,
  };
}

const LINES: HierarchyLine[] = [
  line(['Cafe', 'Bebidas Calientes'], 'Latte', 7000, 2),
  line(['Cafe', 'Bebidas Calientes'], 'Capuchino', 4000, 1, {
    cancelledQuantity: 1,
  }),
  line(['Cafe', 'Bebidas Calientes'], 'Latte', 3500, 1, {
    stationName: 'Cocina',
  }),
  line(['Cafe'], 'Te', 1500, 1),
  line(['Cafe', 'Bebidas Frias', 'Con alcohol'], 'Mojito', 6000, 1),
  line(['Postres'], 'Torta', 2500, 1),
  line(['(Sin categoria)'], 'Cafe suelto', 500, 1),
];

const TOTAL_AMOUNT = 25000;

describe('node ids', () => {
  it('round-trips category paths and keeps the kinds apart', () => {
    const categoryId = encodeNodeId('c', ['Cafe', 'Bebidas Calientes']);
    const itemId = encodeNodeId('i', ['Cafe', 'Bebidas Calientes']);

    expect(categoryId).not.toBe(itemId);
    expect(decodeNodeId(categoryId)).toEqual({
      k: 'c',
      p: ['Cafe', 'Bebidas Calientes'],
    });
    expect(decodeCategoryNodeId(categoryId)).toEqual([
      'Cafe',
      'Bebidas Calientes',
    ]);
  });

  it('round-trips names with unicode, quotes, separators and injection text', () => {
    const path = ['Café "Premium"', "x'; DROP TABLE orders; --", 'a > b | ñ'];

    expect(decodeCategoryNodeId(encodeNodeId('c', path))).toEqual(path);
  });

  it('produces url safe ids', () => {
    expect(encodeNodeId('c', ['¿Qué? ñandú/ü+'])).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  const b64 = (value: unknown): string =>
    Buffer.from(
      typeof value === 'string' ? value : JSON.stringify(value),
    ).toString('base64url');

  it.each([
    ['empty string', ''],
    ['not base64url characters', 'abc$%^&*'],
    ['padded base64', 'e30='],
    ['plain text', b64('hello')],
    ['json null', b64('null')],
    ['json array', b64([1, 2])],
    ['missing path', b64({ k: 'c' })],
    ['unknown kind', b64({ k: 'x', p: ['a'] })],
    ['empty path', b64({ k: 'c', p: [] })],
    ['too many segments', b64({ k: 'c', p: ['a', 'b', 'c', 'd', 'e'] })],
    ['non string segment', b64({ k: 'c', p: ['a', 1] })],
    ['empty segment', b64({ k: 'c', p: [''] })],
    ['object segment', b64({ k: 'c', p: [{ $ne: 1 }] })],
    ['huge segment', b64({ k: 'c', p: ['a'.repeat(201)] })],
    ['huge id', 'A'.repeat(2000)],
    ['sql text', b64("'; DROP TABLE bills; --")],
  ])('rejects a malformed id: %s', (_label, raw) => {
    expect(() => decodeNodeId(raw)).toThrow(BadRequestException);
  });

  it('only accepts category ids with room for a child as parentId', () => {
    expect(() => decodeCategoryNodeId(encodeNodeId('i', ['Cafe']))).toThrow(
      BadRequestException,
    );
    expect(() => decodeCategoryNodeId(encodeNodeId('s', ['Barra']))).toThrow(
      BadRequestException,
    );
    expect(() =>
      decodeCategoryNodeId(encodeNodeId('c', ['a', 'b', 'c', 'd'])),
    ).toThrow(BadRequestException);
  });

  it('builds a breadcrumb that includes every ancestor and the parent itself', () => {
    expect(buildBreadcrumb(['Cafe', 'Bebidas Calientes'])).toEqual([
      { id: encodeNodeId('c', ['Cafe']), name: 'Cafe' },
      {
        id: encodeNodeId('c', ['Cafe', 'Bebidas Calientes']),
        name: 'Bebidas Calientes',
      },
    ]);
  });
});

describe('path helpers', () => {
  it('matches by whole segments, never by text prefix', () => {
    expect(pathStartsWith(['Cafe', 'Frias'], ['Cafe'])).toBe(true);
    expect(pathStartsWith(['Cafeteria'], ['Cafe'])).toBe(false);
    expect(pathStartsWith(['Cafe'], ['Cafe', 'Frias'])).toBe(false);
    expect(pathStartsWith(['Cafe'], [])).toBe(true);
  });

  it('falls back to Sin categoria for missing or empty paths', () => {
    expect(normalizePath(null)).toEqual(['(Sin categoria)']);
    expect(normalizePath([])).toEqual(['(Sin categoria)']);
    expect(normalizePath(['Cafe'])).toEqual(['Cafe']);
  });
});

describe('buildHierarchyView by category', () => {
  it('returns the root categories with their descendants aggregated', () => {
    const view = buildHierarchyView(LINES, 'category', null);

    expect(view.breadcrumb).toEqual([]);
    expect(view.nodes.map((node) => [node.name, node.amount])).toEqual([
      ['Cafe', '22000'],
      ['Postres', '2500'],
      ['(Sin categoria)', '500'],
    ]);
    expect(view.nodes[0]).toMatchObject({
      level: 1,
      kind: 'category',
      hasChildren: true,
      path: ['Cafe'],
      quantity: 6,
      cancelledQuantity: 1,
    });
    expect(view.totals).toEqual({ amount: String(TOTAL_AMOUNT), quantity: 8 });
  });

  it('sum of the root nodes equals the totals', () => {
    const view = buildHierarchyView(LINES, 'category', null);
    const sum = view.nodes.reduce((acc, node) => acc + Number(node.amount), 0);

    expect(sum).toBe(Number(view.totals.amount));
  });

  it('drills down into direct child categories plus the leaf items of the parent', () => {
    const view = buildHierarchyView(LINES, 'category', ['Cafe']);

    expect(
      view.nodes.map((node) => [node.kind, node.name, node.amount, node.level]),
    ).toEqual([
      ['category', 'Bebidas Calientes', '14500', 2],
      ['category', 'Bebidas Frias', '6000', 2],
      ['item', 'Te', '1500', 2],
    ]);
    expect(view.breadcrumb).toEqual([
      { id: encodeNodeId('c', ['Cafe']), name: 'Cafe' },
    ]);
    expect(view.totals.amount).toBe('22000');
    expect(view.nodes.find((node) => node.kind === 'item')).toMatchObject({
      hasChildren: false,
      path: ['Cafe', 'Te'],
    });
  });

  it('unions different stations and menu versions of the same item by name path', () => {
    const view = buildHierarchyView(LINES, 'category', [
      'Cafe',
      'Bebidas Calientes',
    ]);
    const latte = view.nodes.find((node) => node.name === 'Latte');

    expect(latte).toMatchObject({
      amount: '10500',
      quantity: 3,
      averagePrice: '3500',
      kind: 'item',
      level: 3,
    });
    expect(view.totals.amount).toBe('14500');
  });

  it('shows cancelled units as cancelledQuantity without adding amount or quantity', () => {
    const view = buildHierarchyView(
      [
        line(['Cafe'], 'Latte', 3500, 1),
        line(['Cafe'], 'Latte', 0, 0, { cancelledQuantity: 2 }),
        line(['Cafe'], 'Mocha', 0, 0, { cancelledQuantity: 1 }),
      ],
      'category',
      ['Cafe'],
    );

    expect(view.nodes.find((node) => node.name === 'Latte')).toMatchObject({
      amount: '3500',
      quantity: 1,
      cancelledQuantity: 2,
    });
    expect(view.nodes.find((node) => node.name === 'Mocha')).toMatchObject({
      amount: '0',
      quantity: 0,
      cancelledQuantity: 1,
      averagePrice: '0',
      share: 0,
    });
  });

  it('keeps a category and an item with the same name as separate nodes', () => {
    const view = buildHierarchyView(
      [
        line(['Cafe', 'Latte'], 'Doble', 1000, 1),
        line(['Cafe'], 'Latte', 2000, 1),
      ],
      'category',
      ['Cafe'],
    );

    expect(view.nodes.map((node) => [node.kind, node.name])).toEqual([
      ['item', 'Latte'],
      ['category', 'Latte'],
    ]);
    expect(new Set(view.nodes.map((node) => node.id)).size).toBe(2);
  });

  it('returns an empty view for an unknown parent', () => {
    const view = buildHierarchyView(LINES, 'category', ['Nada']);

    expect(view.nodes).toEqual([]);
    expect(view.totals).toEqual({ amount: '0', quantity: 0 });
  });

  it('example from the spec: Cafe > Bebidas Calientes > Latte shows the same amount on the three levels', () => {
    const lines = [line(['Cafe', 'Bebidas Calientes'], 'Latte', 7000, 2)];
    const root = buildHierarchyView(lines, 'category', null);
    const second = buildHierarchyView(lines, 'category', ['Cafe']);
    const third = buildHierarchyView(lines, 'category', [
      'Cafe',
      'Bebidas Calientes',
    ]);

    expect(root.nodes[0].amount).toBe('7000');
    expect(second.nodes[0].amount).toBe('7000');
    expect(third.nodes[0]).toMatchObject({ amount: '7000', quantity: 2 });
  });
});

describe('buildHierarchyView flat groupings', () => {
  it('groups by item name across categories and stations and matches the category total', () => {
    const view = buildHierarchyView(LINES, 'item', null);

    expect(view.nodes.every((node) => node.kind === 'item')).toBe(true);
    expect(view.nodes.every((node) => node.hasChildren === false)).toBe(true);
    expect(view.nodes[0]).toMatchObject({
      name: 'Latte',
      amount: '10500',
      level: 1,
    });
    expect(view.totals).toEqual(
      buildHierarchyView(LINES, 'category', null).totals,
    );
  });

  it('groups by station and ignores parentId', () => {
    const view = buildHierarchyView(LINES, 'station', ['Cafe']);

    expect(view.breadcrumb).toEqual([]);
    expect(view.nodes.map((node) => [node.name, node.amount])).toEqual([
      ['Barra', '21500'],
      ['Cocina', '3500'],
    ]);
    expect(view.totals.amount).toBe(String(TOTAL_AMOUNT));
  });
});

describe('computeShare', () => {
  it('rounds to two decimals and is zero over an empty total', () => {
    expect(computeShare(new Prisma.Decimal(1), new Prisma.Decimal(3))).toBe(
      33.33,
    );
    expect(computeShare(new Prisma.Decimal(2), new Prisma.Decimal(3))).toBe(
      66.67,
    );
    expect(computeShare(new Prisma.Decimal(5), new Prisma.Decimal(0))).toBe(0);
  });

  it('shares of one level add up to about 100', () => {
    const view = buildHierarchyView(LINES, 'category', null);
    const sum = view.nodes.reduce((acc, node) => acc + node.share, 0);

    expect(sum).toBeGreaterThan(99.9);
    expect(sum).toBeLessThan(100.1);
    expect(view.nodes[0].share).toBe(88);
  });
});
