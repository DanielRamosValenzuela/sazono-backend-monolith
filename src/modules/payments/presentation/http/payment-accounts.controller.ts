import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { CompletePaymentAccountConnectionService } from '../../application/complete-payment-account-connection.service';
import { DisconnectPaymentAccountService } from '../../application/disconnect-payment-account.service';
import { GetPaymentAccountStatusService } from '../../application/get-payment-account-status.service';
import { StartPaymentAccountConnectionService } from '../../application/start-payment-account-connection.service';
import { MercadoPagoConfigService } from '../../infrastructure/mercado-pago/mercado-pago-config.service';
import type {
  MercadoPagoAuthorizationUrlResponseDto,
  PaymentAccountStatusResponseDto,
} from './dto/payment-accounts.dto';

@ApiTags('payment-accounts')
@Controller(buildVersionedControllerPath('payment-accounts'))
export class PaymentAccountsController {
  constructor(
    private readonly startPaymentAccountConnectionService: StartPaymentAccountConnectionService,
    private readonly completePaymentAccountConnectionService: CompletePaymentAccountConnectionService,
    private readonly getPaymentAccountStatusService: GetPaymentAccountStatusService,
    private readonly disconnectPaymentAccountService: DisconnectPaymentAccountService,
    private readonly mercadoPagoConfig: MercadoPagoConfigService,
  ) {}

  @Post('mercado-pago/authorization-url')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Genera la URL de autorizacion OAuth de Mercado Pago para el restaurante autenticado. Requiere rol ADMIN.',
  })
  startMercadoPagoConnection(
    @CurrentAuthUser() authUser: JwtPayload,
  ): Promise<MercadoPagoAuthorizationUrlResponseDto> {
    return this.startPaymentAccountConnectionService.execute(authUser);
  }

  @Get('mercado-pago/callback')
  @ApiOperation({
    summary:
      'Callback publico de Mercado Pago tras la autorizacion OAuth. Redirige al frontend con ?status=connected|error.',
  })
  async completeMercadoPagoConnection(
    @Query() query: Record<string, string>,
    @Res() response: Response,
  ): Promise<void> {
    const status = await this.completePaymentAccountConnectionService.execute({
      state: typeof query.state === 'string' ? query.state : undefined,
      code: typeof query.code === 'string' ? query.code : undefined,
      error: typeof query.error === 'string' ? query.error : undefined,
    });

    const redirectUrl = new URL(this.mercadoPagoConfig.oauthUiReturnUrl);
    redirectUrl.searchParams.set('status', status);

    response.redirect(HttpStatus.FOUND, redirectUrl.toString());
  }

  @Get('mercado-pago')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Retorna el estado de la cuenta de Mercado Pago del restaurante autenticado, sin exponer tokens.',
  })
  getMercadoPagoStatus(
    @CurrentAuthUser() authUser: JwtPayload,
  ): Promise<PaymentAccountStatusResponseDto | null> {
    return this.getPaymentAccountStatusService.execute(authUser);
  }

  @Delete('mercado-pago')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Desconecta la cuenta de Mercado Pago del restaurante autenticado. Requiere rol ADMIN.',
  })
  disconnectMercadoPago(
    @CurrentAuthUser() authUser: JwtPayload,
  ): Promise<void> {
    return this.disconnectPaymentAccountService.execute(authUser);
  }
}
