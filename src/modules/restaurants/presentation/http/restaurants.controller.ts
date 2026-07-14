import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import { BootstrapRestaurantService } from '../../application/bootstrap-restaurant.service';
import { GetPlatformMetricsService } from '../../application/get-platform-metrics.service';
import { GetRestaurantBySlugService } from '../../application/get-restaurant-by-slug.service';
import { GetRestaurantDetailService } from '../../application/get-restaurant-detail.service';
import { ListRestaurantsService } from '../../application/list-restaurants.service';
import { SearchRestaurantsService } from '../../application/search-restaurants.service';
import { UpdateRestaurantService } from '../../application/update-restaurant.service';
import {
  BootstrapRestaurantDto,
  BootstrapRestaurantResponseDto,
} from './dto/bootstrap-restaurant.dto';
import { RestaurantSummaryResponseDto } from './dto/list-restaurants.dto';
import { PlatformMetricsResponseDto } from './dto/platform-metrics.dto';
import { RestaurantBySlugResponseDto } from './dto/restaurant-by-slug.dto';
import { RestaurantDetailResponseDto } from './dto/restaurant-detail.dto';
import {
  RestaurantSearchResultDto,
  SearchRestaurantsQueryDto,
} from './dto/search-restaurants.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';

@ApiTags('restaurants')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('restaurants'))
export class RestaurantsController {
  constructor(
    private readonly bootstrapRestaurantService: BootstrapRestaurantService,
    private readonly listRestaurantsService: ListRestaurantsService,
    private readonly getPlatformMetricsService: GetPlatformMetricsService,
    private readonly getRestaurantDetailService: GetRestaurantDetailService,
    private readonly updateRestaurantService: UpdateRestaurantService,
    private readonly getRestaurantBySlugService: GetRestaurantBySlugService,
    private readonly searchRestaurantsService: SearchRestaurantsService,
  ) {}

  @Get('search')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Busca restaurantes activos por prefijo de nombre (para encontrar tu URL de login). Sin autenticacion.',
  })
  search(
    @Query() query: SearchRestaurantsQueryDto,
  ): Promise<RestaurantSearchResultDto[]> {
    return this.searchRestaurantsService.execute(query.q);
  }

  @Get('by-slug/:slug')
  @ApiOperation({
    summary:
      'Resuelve el nombre publico de un restaurante por su slug de login. Sin autenticacion.',
  })
  getBySlug(@Param('slug') slug: string): Promise<RestaurantBySlugResponseDto> {
    return this.getRestaurantBySlugService.execute(slug);
  }

  @Get('platform-metrics')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.PLATFORM_ADMIN)
  @ApiOperation({
    summary:
      'Retorna metricas agregadas de la plataforma para el dashboard de administracion.',
  })
  getPlatformMetrics(): Promise<PlatformMetricsResponseDto> {
    return this.getPlatformMetricsService.execute();
  }

  @Get()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.PLATFORM_ADMIN)
  @ApiOperation({
    summary:
      'Lista los restaurantes clientes con sus totales de sucursales y staff.',
  })
  listRestaurants(): Promise<RestaurantSummaryResponseDto[]> {
    return this.listRestaurantsService.execute();
  }

  @Get(':restaurantId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.PLATFORM_ADMIN)
  @ApiOperation({
    summary:
      'Retorna el detalle de un restaurante con sus sucursales y su staff.',
  })
  getRestaurantDetail(
    @Param('restaurantId') restaurantId: string,
  ): Promise<RestaurantDetailResponseDto> {
    return this.getRestaurantDetailService.execute(restaurantId);
  }

  @Patch(':restaurantId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.PLATFORM_ADMIN)
  @ApiOperation({
    summary: 'Actualiza parcialmente los datos de un restaurante cliente.',
  })
  updateRestaurant(
    @Param('restaurantId') restaurantId: string,
    @Body() dto: UpdateRestaurantDto,
  ): Promise<RestaurantSummaryResponseDto> {
    return this.updateRestaurantService.execute(restaurantId, dto);
  }

  @Post('bootstrap')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.PLATFORM_ADMIN)
  @ApiOperation({
    summary:
      'Crea un restaurante cliente y la primera cuenta admin del restaurante.',
  })
  bootstrap(
    @Body() dto: BootstrapRestaurantDto,
  ): Promise<BootstrapRestaurantResponseDto> {
    return this.bootstrapRestaurantService.execute(dto);
  }
}
