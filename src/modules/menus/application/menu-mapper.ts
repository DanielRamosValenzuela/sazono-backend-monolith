import type {
  MenuCategoryStatus,
  MenuItemType,
  MenuStatus,
  ModifierSelectionType,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import {
  findUnsatisfiedChildGroup,
  isOptionEffectivelyAvailable,
  type ModifierTreeGroup,
  type ModifierTreeOption,
} from '../domain/modifier-tree';
import type {
  MenuDetailResponseDto,
  MenuListItemResponseDto,
  ModifierGroupResponseDto,
  ModifierOptionResponseDto,
  PreparationStationResponseDto,
} from '../presentation/http/dto/menus.dto';

type ModifierOptionRecord = {
  id: string;
  name: string;
  priceDelta: { toString(): string };
  isAvailable: boolean;
  sortOrder: number;
  imageUrl: string | null;
  childGroups?: ModifierGroupRecord[];
};

type ModifierGroupRecord = {
  id: string;
  branchId: string;
  parentOptionId?: string | null;
  name: string;
  selectionType: ModifierSelectionType;
  minSelect: number;
  maxSelect: number | null;
  isRequired: boolean;
  sortOrder: number;
  options: ModifierOptionRecord[];
};

const toTreeGroup = (group: ModifierGroupRecord): ModifierTreeGroup => ({
  ...group,
  options: group.options.map(toTreeOption),
});

const toTreeOption = (option: ModifierOptionRecord): ModifierTreeOption => ({
  ...option,
  priceDelta: option.priceDelta as ModifierTreeOption['priceDelta'],
  childGroups: (option.childGroups ?? []).map(toTreeGroup),
});

export const mapModifierOption = (
  option: ModifierOptionRecord,
  depth = 1,
  publicView = false,
): ModifierOptionResponseDto => {
  const available = publicView
    ? isOptionEffectivelyAvailable(toTreeOption(option))
    : option.isAvailable;

  return {
    modifierOptionId: option.id,
    name: option.name,
    priceDelta: option.priceDelta.toString(),
    isAvailable: available,
    sortOrder: option.sortOrder,
    imageUrl: option.imageUrl,
    childGroups:
      publicView && !available
        ? []
        : (option.childGroups ?? []).map((group) =>
            mapModifierGroup(group, depth + 1, publicView),
          ),
  };
};

export const mapModifierGroup = (
  group: ModifierGroupRecord,
  depth = 1,
  publicView = false,
): ModifierGroupResponseDto => ({
  modifierGroupId: group.id,
  branchId: group.branchId,
  parentOptionId: group.parentOptionId ?? null,
  depth,
  name: group.name,
  selectionType: group.selectionType,
  minSelect: group.minSelect,
  maxSelect: group.maxSelect,
  isRequired: group.isRequired,
  sortOrder: group.sortOrder,
  options: group.options.map((option) =>
    mapModifierOption(option, depth, publicView),
  ),
});

export type MenuPublishWarning = {
  code: 'OPTION_REQUIRED_SUBGROUP_UNAVAILABLE';
  optionName: string;
  groupName: string;
};

export const collectModifierWarnings = (
  groups: ModifierGroupRecord[],
): MenuPublishWarning[] => {
  const seen = new Set<string>();
  const warnings: MenuPublishWarning[] = [];

  const visit = (group: ModifierTreeGroup): void => {
    for (const option of group.options) {
      const blocking = option.isAvailable
        ? findUnsatisfiedChildGroup(option)
        : undefined;

      if (blocking && !seen.has(option.id)) {
        seen.add(option.id);
        warnings.push({
          code: 'OPTION_REQUIRED_SUBGROUP_UNAVAILABLE',
          optionName: option.name,
          groupName: blocking.name,
        });
      }

      (option.childGroups ?? []).forEach(visit);
    }
  };

  groups.map(toTreeGroup).forEach(visit);

  return warnings;
};

export const mapMenuItemModifierGroups = (
  links: Array<{ sortOrder: number; modifierGroup: ModifierGroupRecord }>,
  publicView = false,
): ModifierGroupResponseDto[] =>
  [...links]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((link) => mapModifierGroup(link.modifierGroup, 1, publicView));

export type TranslationEntry = {
  locale: string;
  name: string;
  description: string | null;
};

export type TranslationRecord = {
  entityId: string;
  locale: string;
  fieldName: string;
  translatedValue: string;
};

export const groupTranslationsByEntity = (
  rows: TranslationRecord[],
): Map<string, TranslationEntry[]> => {
  const byEntityAndLocale = new Map<string, Map<string, TranslationEntry>>();

  for (const row of rows) {
    const byLocale =
      byEntityAndLocale.get(row.entityId) ??
      new Map<string, TranslationEntry>();
    const entry = byLocale.get(row.locale) ?? {
      locale: row.locale,
      name: '',
      description: null,
    };

    if (row.fieldName === 'name') {
      entry.name = row.translatedValue;
    } else if (row.fieldName === 'description') {
      entry.description = row.translatedValue;
    }

    byLocale.set(row.locale, entry);
    byEntityAndLocale.set(row.entityId, byLocale);
  }

  const result = new Map<string, TranslationEntry[]>();

  for (const [entityId, byLocale] of byEntityAndLocale) {
    result.set(
      entityId,
      [...byLocale.values()].filter((entry) => entry.name.length > 0),
    );
  }

  return result;
};

type MenuSummaryWithRelations = {
  id: string;
  branchId: string;
  name: string;
  status: MenuStatus;
  version: number;
  publishedAt: Date | null;
  defaultLanguage: string;
  categories: Array<{
    id: string;
    name: string;
    sortOrder: number;
    status: MenuCategoryStatus;
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      price: { toString(): string };
      sku: string | null;
      itemType: MenuItemType;
      isAvailable: boolean;
      sortOrder: number;
    }>;
  }>;
};

type MenuDetailWithRelations = {
  id: string;
  branchId: string;
  name: string;
  status: MenuStatus;
  version: number;
  publishedAt: Date | null;
  defaultLanguage: string;
  categories: Array<{
    id: string;
    name: string;
    sortOrder: number;
    status: MenuCategoryStatus;
    parentId: string | null;
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      price: { toString(): string };
      sku: string | null;
      itemType: MenuItemType;
      isAvailable: boolean;
      sortOrder: number;
      media: Array<{ url: string }>;
      preparationStation: {
        id: string;
        name: string;
        stationType: PreparationStationType;
        status: PreparationStationStatus;
      };
      modifierGroups: Array<{
        sortOrder: number;
        modifierGroup: ModifierGroupRecord;
      }>;
    }>;
  }>;
};

type PreparationStationRecord = {
  id: string;
  branchId: string;
  name: string;
  stationType: PreparationStationType;
  status: PreparationStationStatus;
};

export const mapPreparationStation = (
  station: PreparationStationRecord,
): PreparationStationResponseDto => ({
  preparationStationId: station.id,
  branchId: station.branchId,
  name: station.name,
  stationType: station.stationType,
  status: station.status,
});

export const mapMenuListItem = (
  menu: MenuSummaryWithRelations,
  isDefaultMenu: boolean,
): MenuListItemResponseDto => ({
  menuId: menu.id,
  branchId: menu.branchId,
  name: menu.name,
  status: menu.status,
  version: menu.version,
  defaultLanguage: menu.defaultLanguage,
  publishedAt: menu.publishedAt?.toISOString() ?? null,
  isDefaultMenu,
  categoryCount: menu.categories.length,
  itemCount: menu.categories.reduce(
    (total, category) => total + category.items.length,
    0,
  ),
});

export const mapMenuDetail = (
  menu: MenuDetailWithRelations,
  isDefaultMenu: boolean,
  translationsByEntity: Map<string, TranslationEntry[]> = new Map(),
  publicView = false,
): MenuDetailResponseDto => ({
  menuId: menu.id,
  branchId: menu.branchId,
  name: menu.name,
  status: menu.status,
  version: menu.version,
  defaultLanguage: menu.defaultLanguage,
  publishedAt: menu.publishedAt?.toISOString() ?? null,
  isDefaultMenu,
  categories: menu.categories.map((category) => ({
    menuCategoryId: category.id,
    name: category.name,
    sortOrder: category.sortOrder,
    status: category.status,
    parentId: category.parentId,
    translations: translationsByEntity.get(category.id) ?? [],
    items: category.items.map((item) => ({
      menuItemId: item.id,
      name: item.name,
      description: item.description,
      price: item.price.toString(),
      sku: item.sku,
      itemType: item.itemType,
      isAvailable: item.isAvailable,
      sortOrder: item.sortOrder,
      imageUrl: item.media[0]?.url ?? null,
      translations: translationsByEntity.get(item.id) ?? [],
      preparationStation: {
        preparationStationId: item.preparationStation.id,
        name: item.preparationStation.name,
        stationType: item.preparationStation.stationType,
        status: item.preparationStation.status,
      },
      modifierGroups: mapMenuItemModifierGroups(
        item.modifierGroups,
        publicView,
      ),
    })),
  })),
});
