import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import { BootstrapRestaurantService } from '../../application/bootstrap-restaurant.service';
import { GetPlatformMetricsService } from '../../application/get-platform-metrics.service';
import { GetRestaurantDetailService } from '../../application/get-restaurant-detail.service';
import { ListRestaurantsService } from '../../application/list-restaurants.service';
import { UpdateRestaurantService } from '../../application/update-restaurant.service';
import {
  BootstrapRestaurantDto,
  BootstrapRestaurantResponseDto,
} from './dto/bootstrap-restaurant.dto';
import { RestaurantSummaryResponseDto } from './dto/list-restaurants.dto';
import { PlatformMetricsResponseDto } from './dto/platform-metrics.dto';
import { RestaurantDetailResponseDto } from './dto/restaurant-detail.dto';
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
  ) {}

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
