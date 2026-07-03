import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import { BootstrapRestaurantService } from '../../application/bootstrap-restaurant.service';
import {
  BootstrapRestaurantDto,
  BootstrapRestaurantResponseDto,
} from './dto/bootstrap-restaurant.dto';

@ApiTags('restaurants')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('restaurants'))
export class RestaurantsController {
  constructor(
    private readonly bootstrapRestaurantService: BootstrapRestaurantService,
  ) {}

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
