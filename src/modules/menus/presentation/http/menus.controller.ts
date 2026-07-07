import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { CreatePreparationStationService } from '../../application/create-preparation-station.service';
import { GetMenuDetailService } from '../../application/get-menu-detail.service';
import { ListMenusService } from '../../application/list-menus.service';
import { ListPreparationStationsService } from '../../application/list-preparation-stations.service';
import { PublishMenuService } from '../../application/publish-menu.service';
import {
  CreateMenuCategoryDto,
  CreateMenuDto,
  CreateMenuItemDto,
  CreatePreparationStationDto,
  ListMenusQueryDto,
  ListPreparationStationsQueryDto,
  MenuCategoryResponseDto,
  MenuDetailResponseDto,
  MenuItemResponseDto,
  MenuListItemResponseDto,
  PreparationStationResponseDto,
} from './dto/menus.dto';

@ApiTags('menus')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('menus'))
export class MenusController {
  constructor(
    private readonly createPreparationStationService: CreatePreparationStationService,
    private readonly listPreparationStationsService: ListPreparationStationsService,
    private readonly createMenuService: CreateMenuService,
    private readonly listMenusService: ListMenusService,
    private readonly getMenuDetailService: GetMenuDetailService,
    private readonly createMenuCategoryService: CreateMenuCategoryService,
    private readonly createMenuItemService: CreateMenuItemService,
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
