import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateMenuCategoryService } from './application/create-menu-category.service';
import { CreateMenuItemService } from './application/create-menu-item.service';
import { CreateMenuService } from './application/create-menu.service';
import { CreatePreparationStationService } from './application/create-preparation-station.service';
import { GetMenuDetailService } from './application/get-menu-detail.service';
import { GetPublishedMenuByQrService } from './application/get-published-menu-by-qr.service';
import { ListMenusService } from './application/list-menus.service';
import { ListPreparationStationsService } from './application/list-preparation-stations.service';
import { MenusBranchAdminAccessService } from './application/menus-branch-admin-access.service';
import { PublishMenuService } from './application/publish-menu.service';
import { MenusController } from './presentation/http/menus.controller';
import { QrMenuController } from './presentation/http/qr-menu.controller';

@Module({
  imports: [AuthModule],
  controllers: [MenusController, QrMenuController],
  providers: [
    MenusBranchAdminAccessService,
    CreatePreparationStationService,
    ListPreparationStationsService,
    CreateMenuService,
    ListMenusService,
    GetMenuDetailService,
    GetPublishedMenuByQrService,
    CreateMenuCategoryService,
    CreateMenuItemService,
    PublishMenuService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class MenusModule {}
