import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
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
import { DeviceTokenSoundService } from '../../application/device-token-sound.service';
import { RegisterDeviceTokenService } from '../../application/register-device-token.service';
import { UnregisterDeviceTokenService } from '../../application/unregister-device-token.service';
import {
  DeviceTokenSoundQueryDto,
  RegisterDeviceTokenDto,
  UnregisterDeviceTokenDto,
  UpdateDeviceTokenSoundDto,
} from './dto/device-token.dto';

@ApiTags('notifications')
@Controller(buildVersionedControllerPath('notifications/device-tokens'))
@UseGuards(JwtAuthGuard, ProfileTypeGuard)
@RequireProfileType(LoginProfileType.STAFF)
@ApiBearerAuth()
export class DeviceTokensController {
  constructor(
    private readonly registerDeviceTokenService: RegisterDeviceTokenService,
    private readonly unregisterDeviceTokenService: UnregisterDeviceTokenService,
    private readonly deviceTokenSoundService: DeviceTokenSoundService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Registra (o actualiza) el token FCM del dispositivo del staff autenticado.',
  })
  register(
    @CurrentAuthUser() user: JwtPayload,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<void> {
    return this.registerDeviceTokenService.execute(user.profileId, dto);
  }

  @Delete()
  @ApiOperation({
    summary: 'Desregistra el token FCM del dispositivo (ej. al cerrar sesion).',
  })
  unregister(
    @CurrentAuthUser() user: JwtPayload,
    @Body() dto: UnregisterDeviceTokenDto,
  ): Promise<void> {
    return this.unregisterDeviceTokenService.execute(user.profileId, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Preferencia de sonido de avisos de este dispositivo.',
  })
  getSound(
    @CurrentAuthUser() user: JwtPayload,
    @Query() query: DeviceTokenSoundQueryDto,
  ): Promise<{ soundEnabled: boolean }> {
    return this.deviceTokenSoundService.get(user.profileId, query.fcmToken);
  }

  @Patch('sound')
  @ApiOperation({
    summary: 'Activa o desactiva el sonido de avisos de este dispositivo.',
  })
  setSound(
    @CurrentAuthUser() user: JwtPayload,
    @Body() dto: UpdateDeviceTokenSoundDto,
  ): Promise<{ soundEnabled: boolean }> {
    return this.deviceTokenSoundService.set(
      user.profileId,
      dto.fcmToken,
      dto.soundEnabled,
    );
  }
}
