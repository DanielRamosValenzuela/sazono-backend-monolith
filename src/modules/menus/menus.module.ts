import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateMenuCategoryService } from './application/create-menu-category.service';
import { CreateMenuItemService } from './application/create-menu-item.service';
import { CreateMenuService } from './application/create-menu.service';
import { CreateModifierGroupService } from './application/create-modifier-group.service';
import { CreateModifierOptionService } from './application/create-modifier-option.service';
import { CreatePreparationStationService } from './application/create-preparation-station.service';
import { GetMenuDetailService } from './application/get-menu-detail.service';
import { GetPublishedMenuByQrService } from './application/get-published-menu-by-qr.service';
import { ListMenusService } from './application/list-menus.service';
import { ListModifierGroupsService } from './application/list-modifier-groups.service';
import { ListPreparationStationsService } from './application/list-preparation-stations.service';
import { PublishMenuService } from './application/publish-menu.service';
import { RemoveMenuItemImageService } from './application/remove-menu-item-image.service';
import { ReorderMenuCategoriesService } from './application/reorder-menu-categories.service';
import { ReorderMenuItemsService } from './application/reorder-menu-items.service';
import { SetMenuItemModifierGroupsService } from './application/set-menu-item-modifier-groups.service';
import { UpdateMenuCategoryService } from './application/update-menu-category.service';
import { UpdateMenuItemService } from './application/update-menu-item.service';
import { UpdateModifierGroupService } from './application/update-modifier-group.service';
import { UpdateModifierOptionService } from './application/update-modifier-option.service';
import { UpdatePreparationStationService } from './application/update-preparation-station.service';
import { UploadMenuItemImageService } from './application/upload-menu-item-image.service';
import { UpsertMenuCategoryTranslationService } from './application/upsert-menu-category-translation.service';
import { UpsertMenuItemTranslationService } from './application/upsert-menu-item-translation.service';
import { MenusController } from './presentation/http/menus.controller';
import { QrMenuController } from './presentation/http/qr-menu.controller';

@Module({
  imports: [AuthModule],
  controllers: [MenusController, QrMenuController],
  providers: [
    CreatePreparationStationService,
    ListPreparationStationsService,
    UpdatePreparationStationService,
    CreateMenuService,
    ListMenusService,
    GetMenuDetailService,
    GetPublishedMenuByQrService,
    CreateMenuCategoryService,
    CreateMenuItemService,
    UpdateMenuCategoryService,
    UpdateMenuItemService,
    CreateModifierGroupService,
    UpdateModifierGroupService,
    ListModifierGroupsService,
    CreateModifierOptionService,
    UpdateModifierOptionService,
    SetMenuItemModifierGroupsService,
    ReorderMenuCategoriesService,
    ReorderMenuItemsService,
    UploadMenuItemImageService,
    RemoveMenuItemImageService,
    UpsertMenuCategoryTranslationService,
    UpsertMenuItemTranslationService,
    PublishMenuService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class MenusModule {}
