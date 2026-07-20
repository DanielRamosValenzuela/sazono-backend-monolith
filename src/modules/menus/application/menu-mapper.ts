import type {
  MenuCategoryStatus,
  MenuItemType,
  MenuStatus,
  ModifierSelectionType,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
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
};

type ModifierGroupRecord = {
  id: string;
  branchId: string;
  name: string;
  selectionType: ModifierSelectionType;
  minSelect: number;
  maxSelect: number | null;
  isRequired: boolean;
  sortOrder: number;
  options: ModifierOptionRecord[];
};

export const mapModifierOption = (
  option: ModifierOptionRecord,
): ModifierOptionResponseDto => ({
  modifierOptionId: option.id,
  name: option.name,
  priceDelta: option.priceDelta.toString(),
  isAvailable: option.isAvailable,
  sortOrder: option.sortOrder,
});

export const mapModifierGroup = (
  group: ModifierGroupRecord,
): ModifierGroupResponseDto => ({
  modifierGroupId: group.id,
  branchId: group.branchId,
  name: group.name,
  selectionType: group.selectionType,
  minSelect: group.minSelect,
  maxSelect: group.maxSelect,
  isRequired: group.isRequired,
  sortOrder: group.sortOrder,
  options: group.options.map(mapModifierOption),
});

export const mapMenuItemModifierGroups = (
  links: Array<{ sortOrder: number; modifierGroup: ModifierGroupRecord }>,
): ModifierGroupResponseDto[] =>
  [...links]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((link) => mapModifierGroup(link.modifierGroup));

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
      modifierGroups: mapMenuItemModifierGroups(item.modifierGroups),
    })),
  })),
});
