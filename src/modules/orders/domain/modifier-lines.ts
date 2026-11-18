import { MODIFIER_PATH_SEPARATOR } from '../../menus/domain/modifier-tree';

type ModifierLineRow = {
  id: string;
  parentOrderItemModifierId: string | null;
  depth: number;
  pathSnapshot: string[];
  nameSnapshot: string;
};

export const formatModifierPath = (path: string[]): string =>
  path.join(MODIFIER_PATH_SEPARATOR);

export const formatModifierLines = (rows: ModifierLineRow[]): string[] => {
  const parentIds = new Set(
    rows.map((row) => row.parentOrderItemModifierId).filter(Boolean),
  );

  return [...rows]
    .sort((left, right) => left.depth - right.depth)
    .filter((row) => !parentIds.has(row.id))
    .map((row) =>
      formatModifierPath(
        row.pathSnapshot.length > 0 ? row.pathSnapshot : [row.nameSnapshot],
      ),
    );
};
