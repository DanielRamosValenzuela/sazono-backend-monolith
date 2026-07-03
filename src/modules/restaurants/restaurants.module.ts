import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../auth/guards/profile-type.guard';
import { BootstrapRestaurantService } from './application/bootstrap-restaurant.service';
import { RestaurantsController } from './presentation/http/restaurants.controller';

@Module({
  imports: [AuthModule],
  controllers: [RestaurantsController],
  providers: [BootstrapRestaurantService, JwtAuthGuard, ProfileTypeGuard],
})
export class RestaurantsModule {}
