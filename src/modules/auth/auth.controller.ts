import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { buildVersionedControllerPath } from '../../common/http/api-version';
import { CurrentAuthUser } from './decorators/current-auth-user.decorator';
import {
  AuthResponseDto,
  AuthenticatedProfileDto,
} from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto, SetPinDto } from './dto/pin.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller(buildVersionedControllerPath('auth'))
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Autentica una identidad base y resuelve el perfil operativo.',
  })
  login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Renueva el access token a partir de un refresh token valido.',
  })
  refresh(@Body() refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    return this.authService.refresh(refreshTokenDto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Retorna el perfil autenticado actual.',
  })
  me(@CurrentAuthUser() user: JwtPayload): Promise<AuthenticatedProfileDto> {
    return this.authService.getCurrentUser(user);
  }

  @Post('pin/set')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Configura (o reemplaza) el PIN de desbloqueo rapido del staff autenticado.',
  })
  setPin(
    @CurrentAuthUser() user: JwtPayload,
    @Body() dto: SetPinDto,
  ): Promise<void> {
    return this.authService.setPin(user, dto);
  }

  @Post('pin/login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Entra con PIN sobre un staffUserId ya conocido en el dispositivo (sin contrasena).',
  })
  loginWithPin(@Body() dto: PinLoginDto): Promise<AuthResponseDto> {
    return this.authService.loginWithPin(dto);
  }
}
