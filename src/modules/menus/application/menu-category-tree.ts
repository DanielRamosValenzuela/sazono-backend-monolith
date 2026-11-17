import { BadRequestException } from '@nestjs/common';
import { MenuCategoryStatus } from '@prisma/client';

export const MAX_CATEGORY_DEPTH = 3;

export type CategoryTreeNode = { id: string; parentId: string | null };

type CategoryWithParents = {
  name: string;
  parent?: CategoryWithParents | null;
};

const CYCLE_MESSAGE =
  'La categoria padre no puede ser la misma categoria ni una de sus descendientes.';

function depthFrom(
  byId: Map<string, CategoryTreeNode>,
  startId: string,
  forbiddenId: string | null,
): number {
  const seen = new Set<string>();
  let depth = 0;
  let currentId: string | null = startId;

  while (currentId) {
    if (currentId === forbiddenId || seen.has(currentId)) {
      throw new BadRequestException(CYCLE_MESSAGE);
    }

    seen.add(currentId);
    depth += 1;
    currentId = byId.get(currentId)?.parentId ?? null;
  }

  return depth;
}

function subtreeHeight(
  categories: CategoryTreeNode[],
  rootId: string,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(rootId)) {
    throw new BadRequestException(CYCLE_MESSAGE);
  }

  seen.add(rootId);

  const childHeights = categories
    .filter((category) => category.parentId === rootId)
    .map((child) => subtreeHeight(categories, child.id, seen));

  return 1 + Math.max(0, ...childHeights);
}

export function assertValidCategoryParent(
  categories: CategoryTreeNode[],
  parentId: string,
  categoryId: string | null,
): void {
  const byId = new Map(categories.map((category) => [category.id, category]));

  if (!byId.has(parentId)) {
    throw new BadRequestException(
      'La categoria padre no existe en esta carta.',
    );
  }

  const parentDepth = depthFrom(byId, parentId, categoryId);
  const ownHeight =
    categoryId === null ? 1 : subtreeHeight(categories, categoryId);

  if (parentDepth + ownHeight > MAX_CATEGORY_DEPTH) {
    throw new BadRequestException(
      `Las categorias admiten como maximo ${MAX_CATEGORY_DEPTH} niveles.`,
    );
  }
}

export function keepReachableCategories<T extends CategoryTreeNode>(
  categories: T[],
): T[] {
  let kept = categories;
  let changed = true;

  while (changed) {
    const keptIds = new Set(kept.map((category) => category.id));
    const next = kept.filter(
      (category) => !category.parentId || keptIds.has(category.parentId),
    );

    changed = next.length !== kept.length;
    kept = next;
  }

  return kept;
}

export function hasPublishableContent<
  T extends CategoryTreeNode & {
    status: MenuCategoryStatus;
    items: unknown[];
  },
>(categories: T[]): boolean {
  return keepReachableCategories(
    categories.filter(
      (category) => category.status === MenuCategoryStatus.ACTIVE,
    ),
  ).some((category) => category.items.length > 0);
}

export function categoryPathOf(category: CategoryWithParents): string[] {
  const names: string[] = [];
  let current: CategoryWithParents | null | undefined = category;

  while (current && names.length < MAX_CATEGORY_DEPTH) {
    names.unshift(current.name);
    current = current.parent;
  }

  return names;
}
