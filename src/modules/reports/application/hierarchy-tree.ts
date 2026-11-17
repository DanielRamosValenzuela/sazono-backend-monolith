import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const UNCATEGORIZED_LABEL = '(Sin categoria)';
export const HIERARCHY_GROUPS = ['category', 'item', 'station'] as const;

export type HierarchyGroupBy = (typeof HIERARCHY_GROUPS)[number];
export type HierarchyNodeKind = 'category' | 'item';

export type HierarchyLine = {
  path: string[];
  itemName: string;
  stationName: string;
  amount: Prisma.Decimal.Value;
  quantity: number;
  cancelledQuantity: number;
};

export type HierarchyNode = {
  id: string;
  name: string;
  path: string[];
  level: number;
  kind: HierarchyNodeKind;
  hasChildren: boolean;
  amount: string;
  quantity: number;
  share: number;
  cancelledQuantity: number;
  averagePrice: string;
};

export type HierarchyBreadcrumb = { id: string; name: string };

export type HierarchyView = {
  breadcrumb: HierarchyBreadcrumb[];
  nodes: HierarchyNode[];
  totals: { amount: string; quantity: number };
};

type NodeRefKind = 'c' | 'i' | 's';
type NodeRef = { k: NodeRefKind; p: string[] };

const MAX_NODE_ID_LENGTH = 2048;
const MAX_PATH_SEGMENTS = 4;
const MAX_SEGMENT_LENGTH = 200;
const NODE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const NODE_REF_KINDS: string[] = ['c', 'i', 's'];
const ZERO = new Prisma.Decimal(0);

const money = (value: Prisma.Decimal.Value): string =>
  new Prisma.Decimal(value).toFixed(0);

export function encodeNodeId(kind: NodeRefKind, path: string[]): string {
  return Buffer.from(JSON.stringify({ k: kind, p: path })).toString(
    'base64url',
  );
}

export function decodeNodeId(raw: string): NodeRef {
  const invalid = new BadRequestException(
    'El identificador de nodo no es valido.',
  );

  if (raw.length === 0 || raw.length > MAX_NODE_ID_LENGTH) {
    throw invalid;
  }

  if (!NODE_ID_PATTERN.test(raw)) {
    throw invalid;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw invalid;
  }

  const { k, p } = parsed as { k?: unknown; p?: unknown };

  if (
    typeof k !== 'string' ||
    !NODE_REF_KINDS.includes(k) ||
    !Array.isArray(p) ||
    p.length === 0 ||
    p.length > MAX_PATH_SEGMENTS ||
    !p.every(
      (segment): segment is string =>
        typeof segment === 'string' &&
        segment.length > 0 &&
        segment.length <= MAX_SEGMENT_LENGTH,
    )
  ) {
    throw invalid;
  }

  return { k: k as NodeRefKind, p };
}

export function decodeCategoryNodeId(raw: string): string[] {
  const ref = decodeNodeId(raw);

  if (ref.k !== 'c' || ref.p.length >= MAX_PATH_SEGMENTS) {
    throw new BadRequestException('El identificador de nodo no es valido.');
  }

  return ref.p;
}

export function normalizePath(path: string[] | null): string[] {
  return path && path.length > 0 ? path : [UNCATEGORIZED_LABEL];
}

export function pathStartsWith(path: string[], prefix: string[]): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((segment, index) => path[index] === segment)
  );
}

export function buildBreadcrumb(parentPath: string[]): HierarchyBreadcrumb[] {
  return parentPath.map((name, index) => ({
    id: encodeNodeId('c', parentPath.slice(0, index + 1)),
    name,
  }));
}

type Accumulator = {
  id: string;
  name: string;
  path: string[];
  kind: HierarchyNodeKind;
  hasChildren: boolean;
  amount: Prisma.Decimal;
  quantity: number;
  cancelledQuantity: number;
};

function accumulate(
  groups: Map<string, Accumulator>,
  key: string,
  seed: Omit<Accumulator, 'amount' | 'quantity' | 'cancelledQuantity'>,
  line: HierarchyLine,
): void {
  const group = groups.get(key) ?? {
    ...seed,
    amount: ZERO,
    quantity: 0,
    cancelledQuantity: 0,
  };

  group.amount = group.amount.add(line.amount);
  group.quantity += line.quantity;
  group.cancelledQuantity += line.cancelledQuantity;
  groups.set(key, group);
}

export function computeShare(
  amount: Prisma.Decimal,
  total: Prisma.Decimal,
): number {
  if (total.lte(0)) {
    return 0;
  }

  return amount.div(total).mul(100).toDecimalPlaces(2).toNumber();
}

function finalize(groups: Map<string, Accumulator>): HierarchyView['nodes'] {
  const entries = [...groups.values()];
  const total = entries.reduce((sum, entry) => sum.add(entry.amount), ZERO);

  return entries
    .map((entry): HierarchyNode => ({
      id: entry.id,
      name: entry.name,
      path: entry.path,
      level: entry.path.length,
      kind: entry.kind,
      hasChildren: entry.hasChildren,
      amount: money(entry.amount),
      quantity: entry.quantity,
      share: computeShare(entry.amount, total),
      cancelledQuantity: entry.cancelledQuantity,
      averagePrice:
        entry.quantity > 0 ? money(entry.amount.div(entry.quantity)) : '0',
    }))
    .sort(
      (left, right) =>
        new Prisma.Decimal(right.amount).cmp(left.amount) ||
        right.quantity - left.quantity ||
        left.name.localeCompare(right.name),
    );
}

function totalsOf(nodes: HierarchyNode[]): HierarchyView['totals'] {
  return {
    amount: money(
      nodes.reduce((sum, node) => sum.add(node.amount), new Prisma.Decimal(0)),
    ),
    quantity: nodes.reduce((sum, node) => sum + node.quantity, 0),
  };
}

export function buildHierarchyView(
  lines: HierarchyLine[],
  groupBy: HierarchyGroupBy,
  parentPath: string[] | null,
): HierarchyView {
  const groups = new Map<string, Accumulator>();

  if (groupBy === 'item') {
    for (const line of lines) {
      accumulate(
        groups,
        line.itemName,
        {
          id: encodeNodeId('i', [line.itemName]),
          name: line.itemName,
          path: [line.itemName],
          kind: 'item',
          hasChildren: false,
        },
        line,
      );
    }
  } else if (groupBy === 'station') {
    for (const line of lines) {
      accumulate(
        groups,
        line.stationName,
        {
          id: encodeNodeId('s', [line.stationName]),
          name: line.stationName,
          path: [line.stationName],
          kind: 'category',
          hasChildren: false,
        },
        line,
      );
    }
  } else {
    const prefix = parentPath ?? [];

    for (const line of lines) {
      if (!pathStartsWith(line.path, prefix)) {
        continue;
      }

      if (line.path.length > prefix.length) {
        const path = line.path.slice(0, prefix.length + 1);

        accumulate(
          groups,
          JSON.stringify(['c', path]),
          {
            id: encodeNodeId('c', path),
            name: path[path.length - 1],
            path,
            kind: 'category',
            hasChildren: true,
          },
          line,
        );
      } else {
        const path = [...line.path, line.itemName];

        accumulate(
          groups,
          JSON.stringify(['i', path]),
          {
            id: encodeNodeId('i', path),
            name: line.itemName,
            path,
            kind: 'item',
            hasChildren: false,
          },
          line,
        );
      }
    }
  }

  const nodes = finalize(groups);

  return {
    breadcrumb:
      groupBy === 'category' && parentPath ? buildBreadcrumb(parentPath) : [],
    nodes,
    totals: totalsOf(nodes),
  };
}
