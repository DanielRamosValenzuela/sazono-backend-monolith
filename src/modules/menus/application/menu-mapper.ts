import type {
  MenuCategoryStatus,
  MenuItemType,
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import type {
  MenuDetailResponseDto,
  MenuListItemResponseDto,
  PreparationStationResponseDto,
} from '../presentation/http/dto/menus.dto';

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
      preparationStation: {
        id: string;
        name: string;
        stationType: PreparationStationType;
        status: PreparationStationStatus;
      };
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
    items: category.items.map((item) => ({
      menuItemId: item.id,
      name: item.name,
      description: item.description,
      price: item.price.toString(),
      sku: item.sku,
      itemType: item.itemType,
      isAvailable: item.isAvailable,
      preparationStation: {
        preparationStationId: item.preparationStation.id,
        name: item.preparationStation.name,
        stationType: item.preparationStation.stationType,
        status: item.preparationStation.status,
      },
    })),
  })),
});
