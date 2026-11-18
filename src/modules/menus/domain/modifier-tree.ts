import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export const MODIFIER_MAX_DEPTH = 3;
export const MODIFIER_PATH_SEPARATOR = ' > ';

export type ModifierTreeOption = {
  id: string;
  name: string;
  priceDelta: Prisma.Decimal;
  isAvailable: boolean;
  childGroups?: ModifierTreeGroup[];
};

export type ModifierTreeGroup = {
  id: string;
  name: string;
  selectionType?: string;
  minSelect: number;
  maxSelect: number | null;
  isRequired: boolean;
  options: ModifierTreeOption[];
};

export type ResolvedModifier = {
  option: ModifierTreeOption;
  parentOptionId: string | null;
  depth: number;
  path: string[];
};

type OptionEntry = ResolvedModifier & {
  group: ModifierTreeGroup;
  parentName: string | null;
};

type AncestryGroup = {
  id: string;
  parentOption?: { modifierGroup: AncestryGroup } | null;
};

export const effectiveMin = (group: ModifierTreeGroup): number =>
  group.isRequired ? Math.max(group.minSelect, 1) : group.minSelect;

export const findUnsatisfiedChildGroup = (
  option: ModifierTreeOption,
): ModifierTreeGroup | undefined =>
  (option.childGroups ?? []).find(
    (group) =>
      group.options.filter(isOptionEffectivelyAvailable).length <
      effectiveMin(group),
  );

export const isOptionEffectivelyAvailable = (
  option: ModifierTreeOption,
): boolean => option.isAvailable && !findUnsatisfiedChildGroup(option);

export const modifierGroupDepth = (group: AncestryGroup): number => {
  const seen = new Set([group.id]);
  let depth = 1;
  let current = group;

  while (current.parentOption) {
    current = current.parentOption.modifierGroup;

    if (seen.has(current.id)) {
      throw new BadRequestException(
        'La jerarquia de modificadores es invalida.',
      );
    }

    seen.add(current.id);
    depth += 1;
  }

  return depth;
};

const indexTree = (
  groups: ModifierTreeGroup[],
  parent: OptionEntry | null,
  index: Map<string, OptionEntry>,
): void => {
  const depth = (parent?.depth ?? 0) + 1;

  if (depth > MODIFIER_MAX_DEPTH) {
    return;
  }

  for (const group of groups) {
    for (const option of group.options) {
      const entry: OptionEntry = {
        option,
        group,
        parentOptionId: parent?.option.id ?? null,
        parentName: parent?.option.name ?? null,
        depth,
        path: [...(parent?.path ?? []), option.name],
      };
      index.set(option.id, entry);
      indexTree(option.childGroups ?? [], entry, index);
    }
  }
};

export const resolveModifierSelection = (
  rootGroups: ModifierTreeGroup[],
  selectedIds: string[],
  itemName: string,
): ResolvedModifier[] => {
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new BadRequestException(
      'No puedes repetir un mismo modificador en un item.',
    );
  }

  const index = new Map<string, OptionEntry>();
  indexTree(rootGroups, null, index);
  const selected = new Set(selectedIds);
  const countByGroup = new Map<string, number>();

  for (const optionId of selectedIds) {
    const entry = index.get(optionId);

    if (!entry) {
      throw new BadRequestException(
        `Uno de los modificadores seleccionados no pertenece al item "${itemName}".`,
      );
    }

    if (!isOptionEffectivelyAvailable(entry.option)) {
      throw new BadRequestException(
        `El modificador "${entry.option.name}" no esta disponible.`,
      );
    }

    if (entry.parentOptionId && !selected.has(entry.parentOptionId)) {
      throw new BadRequestException(
        `El modificador "${entry.option.name}" requiere seleccionar antes "${entry.parentName}".`,
      );
    }

    countByGroup.set(
      entry.group.id,
      (countByGroup.get(entry.group.id) ?? 0) + 1,
    );
  }

  const validateGroups = (
    groups: ModifierTreeGroup[],
    parentName: string | null,
  ): void => {
    for (const group of groups) {
      const count = countByGroup.get(group.id) ?? 0;
      const label = parentName
        ? `"${group.name}" (${parentName})`
        : `"${group.name}"`;
      const min = effectiveMin(group);

      if (count < min) {
        throw new BadRequestException(
          `Debes seleccionar al menos ${min} opcion(es) de ${label} para "${itemName}".`,
        );
      }

      const max = group.selectionType === 'ONE' ? 1 : group.maxSelect;

      if (max !== null && count > max) {
        throw new BadRequestException(
          `Puedes seleccionar como maximo ${max} opcion(es) de ${label} para "${itemName}".`,
        );
      }

      for (const option of group.options) {
        if (selected.has(option.id)) {
          validateGroups(option.childGroups ?? [], option.name);
        }
      }
    }
  };

  validateGroups(rootGroups, null);

  return selectedIds
    .map((id) => index.get(id) as OptionEntry)
    .sort((left, right) => left.depth - right.depth)
    .map(({ option, parentOptionId, depth, path }) => ({
      option,
      parentOptionId,
      depth,
      path,
    }));
};
