import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { CreateMenuCategoryService } from '../../application/create-menu-category.service';
import { CreateMenuItemService } from '../../application/create-menu-item.service';
import { CreateMenuService } from '../../application/create-menu.service';
import { CreateModifierGroupService } from '../../application/create-modifier-group.service';
import { CreateModifierOptionService } from '../../application/create-modifier-option.service';
import { CreatePreparationStationService } from '../../application/create-preparation-station.service';
import { GetMenuDetailService } from '../../application/get-menu-detail.service';
import { ListMenusService } from '../../application/list-menus.service';
import { ListModifierGroupsService } from '../../application/list-modifier-groups.service';
import { ListPreparationStationsService } from '../../application/list-preparation-stations.service';
import { PublishMenuService } from '../../application/publish-menu.service';
import { SetMenuItemModifierGroupsService } from '../../application/set-menu-item-modifier-groups.service';
import { UpdatePreparationStationService } from '../../application/update-preparation-station.service';
import { RemoveMenuItemImageService } from '../../application/remove-menu-item-image.service';
import { ReorderMenuCategoriesService } from '../../application/reorder-menu-categories.service';
import { ReorderMenuItemsService } from '../../application/reorder-menu-items.service';
import { UpdateMenuCategoryService } from '../../application/update-menu-category.service';
import { UpdateMenuItemService } from '../../application/update-menu-item.service';
import { UpdateModifierGroupService } from '../../application/update-modifier-group.service';
import { UpdateModifierOptionService } from '../../application/update-modifier-option.service';
import { UploadMenuItemImageService } from '../../application/upload-menu-item-image.service';
import { UpsertMenuCategoryTranslationService } from '../../application/upsert-menu-category-translation.service';
import { UpsertMenuItemTranslationService } from '../../application/upsert-menu-item-translation.service';
import {
  CreateMenuCategoryDto,
  CreateMenuDto,
  CreateMenuItemDto,
  CreateModifierGroupDto,
  CreateModifierOptionDto,
  CreatePreparationStationDto,
  ListMenusQueryDto,
  ListModifierGroupsQueryDto,
  ListPreparationStationsQueryDto,
  MenuCategoryResponseDto,
  MenuDetailResponseDto,
  MenuItemResponseDto,
  MenuListItemResponseDto,
  ModifierGroupResponseDto,
  ModifierOptionResponseDto,
  PreparationStationResponseDto,
  ReorderMenuCategoriesDto,
  ReorderMenuItemsDto,
  SetMenuItemModifierGroupsDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto,
  UpdateModifierGroupDto,
  UpdateModifierOptionDto,
  UpdatePreparationStationDto,
  UpsertCategoryTranslationDto,
  UpsertItemTranslationDto,
} from './dto/menus.dto';

@ApiTags('menus')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('menus'))
export class MenusController {
  constructor(
    private readonly createPreparationStationService: CreatePreparationStationService,
    private readonly listPreparationStationsService: ListPreparationStationsService,
    private readonly updatePreparationStationService: UpdatePreparationStationService,
    private readonly createMenuService: CreateMenuService,
    private readonly listMenusService: ListMenusService,
    private readonly getMenuDetailService: GetMenuDetailService,
    private readonly createMenuCategoryService: CreateMenuCategoryService,
    private readonly createMenuItemService: CreateMenuItemService,
    private readonly updateMenuCategoryService: UpdateMenuCategoryService,
    private readonly updateMenuItemService: UpdateMenuItemService,
    private readonly createModifierGroupService: CreateModifierGroupService,
    private readonly updateModifierGroupService: UpdateModifierGroupService,
    private readonly listModifierGroupsService: ListModifierGroupsService,
    private readonly createModifierOptionService: CreateModifierOptionService,
    private readonly updateModifierOptionService: UpdateModifierOptionService,
    private readonly setMenuItemModifierGroupsService: SetMenuItemModifierGroupsService,
    private readonly reorderMenuCategoriesService: ReorderMenuCategoriesService,
    private readonly reorderMenuItemsService: ReorderMenuItemsService,
    private readonly uploadMenuItemImageService: UploadMenuItemImageService,
    private readonly removeMenuItemImageService: RemoveMenuItemImageService,
    private readonly upsertMenuCategoryTranslationService: UpsertMenuCategoryTranslationService,
    private readonly upsertMenuItemTranslationService: UpsertMenuItemTranslationService,
    private readonly publishMenuService: PublishMenuService,
  ) {}

  @Post('preparation-stations')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Crea una estacion de preparacion operativa para una sucursal.',
  })
  createPreparationStation(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: CreatePreparationStationDto,
  ): Promise<PreparationStationResponseDto> {
    return this.createPreparationStationService.execute(authUser, dto);
  }

  @Get('preparation-stations')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Lista las estaciones de preparacion configuradas para una sucursal.',
  })
  listPreparationStations(
    @CurrentAuthUser() authUser: JwtPayload,
    @Query() query: ListPreparationStationsQueryDto,
  ): Promise<PreparationStationResponseDto[]> {
    return this.listPreparationStationsService.execute(authUser, query);
  }

  @Patch('preparation-stations/:preparationStationId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Edita nombre, tipo o estado (activar/desactivar) de una estacion de preparacion.',
  })
  updatePreparationStation(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('preparationStationId') preparationStationId: string,
    @Body() dto: UpdatePreparationStationDto,
  ): Promise<PreparationStationResponseDto> {
    return this.updatePreparationStationService.execute(
      authUser,
      preparationStationId,
      dto,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Crea una nueva version draft de carta para una sucursal.',
  })
  createMenu(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: CreateMenuDto,
  ): Promise<MenuListItemResponseDto> {
    return this.createMenuService.execute(authUser, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Lista las versiones de carta disponibles en una sucursal.',
  })
  listMenus(
    @CurrentAuthUser() authUser: JwtPayload,
    @Query() query: ListMenusQueryDto,
  ): Promise<MenuListItemResponseDto[]> {
    return this.listMenusService.execute(authUser, query);
  }

  @Get(':menuId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Retorna el detalle de una carta con categorias e items.',
  })
  getMenuDetail(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuId') menuId: string,
  ): Promise<MenuDetailResponseDto> {
    return this.getMenuDetailService.execute(authUser, menuId);
  }

  @Post(':menuId/categories')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Agrega una categoria a una carta en estado draft.',
  })
  createMenuCategory(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuId') menuId: string,
    @Body() dto: CreateMenuCategoryDto,
  ): Promise<MenuCategoryResponseDto> {
    return this.createMenuCategoryService.execute(authUser, menuId, dto);
  }

  @Patch('categories/:menuCategoryId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Edita nombre, orden o estado (activa/oculta/archivada) de una categoria en una carta draft.',
  })
  updateMenuCategory(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuCategoryId') menuCategoryId: string,
    @Body() dto: UpdateMenuCategoryDto,
  ): Promise<MenuCategoryResponseDto> {
    return this.updateMenuCategoryService.execute(
      authUser,
      menuCategoryId,
      dto,
    );
  }

  @Put('categories/:menuCategoryId/translations/:locale')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Crea o reemplaza la traduccion de nombre de una categoria para el locale indicado, sobre una carta draft.',
  })
  upsertMenuCategoryTranslation(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuCategoryId') menuCategoryId: string,
    @Param('locale') locale: string,
    @Body() dto: UpsertCategoryTranslationDto,
  ): Promise<{ locale: string; name: string; description: string | null }> {
    return this.upsertMenuCategoryTranslationService.execute(
      authUser,
      menuCategoryId,
      locale,
      dto,
    );
  }

  @Patch(':menuId/categories/reorder')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Reordena de una vez todas las categorias de una carta draft segun el arreglo de ids recibido.',
  })
  reorderMenuCategories(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuId') menuId: string,
    @Body() dto: ReorderMenuCategoriesDto,
  ): Promise<{ reorderedCount: number }> {
    return this.reorderMenuCategoriesService.execute(authUser, menuId, dto);
  }

  @Post('categories/:menuCategoryId/items')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Agrega un item a una categoria de carta en estado draft.',
  })
  createMenuItem(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuCategoryId') menuCategoryId: string,
    @Body() dto: CreateMenuItemDto,
  ): Promise<MenuItemResponseDto> {
    return this.createMenuItemService.execute(authUser, menuCategoryId, dto);
  }

  @Patch('items/:menuItemId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Edita nombre, precio, descripcion, estacion o disponibilidad de un item en una carta draft.',
  })
  updateMenuItem(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuItemId') menuItemId: string,
    @Body() dto: UpdateMenuItemDto,
  ): Promise<MenuItemResponseDto> {
    return this.updateMenuItemService.execute(authUser, menuItemId, dto);
  }

  @Post('modifier-groups')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Crea un grupo de modificadores para una sucursal (reutilizable entre productos).',
  })
  createModifierGroup(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: CreateModifierGroupDto,
  ): Promise<ModifierGroupResponseDto> {
    return this.createModifierGroupService.execute(authUser, dto);
  }

  @Get('modifier-groups')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Lista los grupos de modificadores disponibles en una sucursal.',
  })
  listModifierGroups(
    @CurrentAuthUser() authUser: JwtPayload,
    @Query() query: ListModifierGroupsQueryDto,
  ): Promise<ModifierGroupResponseDto[]> {
    return this.listModifierGroupsService.execute(authUser, query);
  }

  @Patch('modifier-groups/:modifierGroupId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Edita nombre, tipo de seleccion o cardinalidad de un grupo de modificadores.',
  })
  updateModifierGroup(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('modifierGroupId') modifierGroupId: string,
    @Body() dto: UpdateModifierGroupDto,
  ): Promise<ModifierGroupResponseDto> {
    return this.updateModifierGroupService.execute(
      authUser,
      modifierGroupId,
      dto,
    );
  }

  @Post('modifier-groups/:modifierGroupId/options')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Agrega una opcion a un grupo de modificadores.',
  })
  createModifierOption(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('modifierGroupId') modifierGroupId: string,
    @Body() dto: CreateModifierOptionDto,
  ): Promise<ModifierOptionResponseDto> {
    return this.createModifierOptionService.execute(
      authUser,
      modifierGroupId,
      dto,
    );
  }

  @Patch('modifier-options/:modifierOptionId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Edita nombre, costo adicional o disponibilidad de una opcion de modificador.',
  })
  updateModifierOption(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('modifierOptionId') modifierOptionId: string,
    @Body() dto: UpdateModifierOptionDto,
  ): Promise<ModifierOptionResponseDto> {
    return this.updateModifierOptionService.execute(
      authUser,
      modifierOptionId,
      dto,
    );
  }

  @Put('items/:menuItemId/modifier-groups')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Reemplaza de una vez el conjunto de grupos de modificadores asignados a un item.',
  })
  setMenuItemModifierGroups(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuItemId') menuItemId: string,
    @Body() dto: SetMenuItemModifierGroupsDto,
  ): Promise<ModifierGroupResponseDto[]> {
    return this.setMenuItemModifierGroupsService.execute(
      authUser,
      menuItemId,
      dto,
    );
  }

  @Put('items/:menuItemId/translations/:locale')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Crea o reemplaza la traduccion de nombre/descripcion de un item para el locale indicado, sobre una carta draft.',
  })
  upsertMenuItemTranslation(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuItemId') menuItemId: string,
    @Param('locale') locale: string,
    @Body() dto: UpsertItemTranslationDto,
  ): Promise<{ locale: string; name: string; description: string | null }> {
    return this.upsertMenuItemTranslationService.execute(
      authUser,
      menuItemId,
      locale,
      dto,
    );
  }

  @Post('items/:menuItemId/media')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Sube (o reemplaza) la imagen principal de un item en una carta draft. Campo multipart "file", JPEG/PNG/WEBP hasta 5MB.',
  })
  uploadMenuItemImage(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuItemId') menuItemId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<MenuItemResponseDto> {
    return this.uploadMenuItemImageService.execute(authUser, menuItemId, file);
  }

  @Delete('items/:menuItemId/media')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary: 'Quita la imagen principal de un item en una carta draft.',
  })
  removeMenuItemImage(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuItemId') menuItemId: string,
  ): Promise<MenuItemResponseDto> {
    return this.removeMenuItemImageService.execute(authUser, menuItemId);
  }

  @Patch('categories/:menuCategoryId/items/reorder')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Reordena de una vez todos los items de una categoria draft segun el arreglo de ids recibido.',
  })
  reorderMenuItems(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuCategoryId') menuCategoryId: string,
    @Body() dto: ReorderMenuItemsDto,
  ): Promise<{ reorderedCount: number }> {
    return this.reorderMenuItemsService.execute(authUser, menuCategoryId, dto);
  }

  @Post(':menuId/publish')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Publica una carta draft y la deja como menu activo de la sucursal.',
  })
  publishMenu(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('menuId') menuId: string,
  ): Promise<MenuDetailResponseDto> {
    return this.publishMenuService.execute(authUser, menuId);
  }
}
