import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { BootstrapRestaurantService } from './application/bootstrap-restaurant.service';
import { GetPlatformMetricsService } from './application/get-platform-metrics.service';
import { GetRestaurantBySlugService } from './application/get-restaurant-by-slug.service';
import { GetRestaurantDetailService } from './application/get-restaurant-detail.service';
import { ListRestaurantsService } from './application/list-restaurants.service';
import { SearchRestaurantsService } from './application/search-restaurants.service';
import { UpdateRestaurantService } from './application/update-restaurant.service';
import { RestaurantsController } from './presentation/http/restaurants.controller';

@Module({
  imports: [AuthModule],
  controllers: [RestaurantsController],
  providers: [
    BootstrapRestaurantService,
    ListRestaurantsService,
    GetPlatformMetricsService,
    GetRestaurantDetailService,
    GetRestaurantBySlugService,
    SearchRestaurantsService,
    UpdateRestaurantService,
    JwtAuthGuard,
    ProfileTypeGuard,
  ],
})
export class RestaurantsModule {}
