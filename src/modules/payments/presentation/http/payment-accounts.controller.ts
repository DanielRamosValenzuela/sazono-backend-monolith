import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentGatewayProvider } from '@prisma/client';
import type { Response } from 'express';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { CompletePaymentAccountConnectionService } from '../../application/complete-payment-account-connection.service';
import { ConfirmRedirectPaymentService } from '../../application/confirm-redirect-payment.service';
import { ConnectTransbankAccountService } from '../../application/connect-transbank-account.service';
import { DisconnectPaymentAccountService } from '../../application/disconnect-payment-account.service';
import { DisconnectTransbankAccountService } from '../../application/disconnect-transbank-account.service';
import { GetPaymentAccountStatusService } from '../../application/get-payment-account-status.service';
import { GetTransbankAccountStatusService } from '../../application/get-transbank-account-status.service';
import { PausePaymentAccountService } from '../../application/pause-payment-account.service';
import { ResumePaymentAccountService } from '../../application/resume-payment-account.service';
import { SetPreferredPaymentAccountService } from '../../application/set-preferred-payment-account.service';
import { StartPaymentAccountConnectionService } from '../../application/start-payment-account-connection.service';
import { MercadoPagoConfigService } from '../../infrastructure/mercado-pago/mercado-pago-config.service';
import type { ConfirmRedirectPaymentResponseDto } from './dto/payments.dto';
import {
  ConnectTransbankAccountDto,
  TransbankReturnDto,
} from './dto/payment-accounts.dto';
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
    private readonly pausePaymentAccountService: PausePaymentAccountService,
    private readonly resumePaymentAccountService: ResumePaymentAccountService,
    private readonly setPreferredPaymentAccountService: SetPreferredPaymentAccountService,
    private readonly mercadoPagoConfig: MercadoPagoConfigService,
    private readonly connectTransbankAccountService: ConnectTransbankAccountService,
    private readonly getTransbankAccountStatusService: GetTransbankAccountStatusService,
    private readonly disconnectTransbankAccountService: DisconnectTransbankAccountService,
    private readonly confirmRedirectPaymentService: ConfirmRedirectPaymentService,
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

  @Patch(':provider/pause')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Pausa una pasarela CONNECTED sin desconectarla (no se ofrece a los clientes hasta reanudarla). Requiere rol ADMIN.',
  })
  pausePaymentAccount(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('provider', new ParseEnumPipe(PaymentGatewayProvider))
    provider: PaymentGatewayProvider,
  ): Promise<PaymentAccountStatusResponseDto> {
    return this.pausePaymentAccountService.execute(authUser, provider);
  }

  @Patch(':provider/resume')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Reanuda una pasarela PAUSED, volviendola a ofrecer a los clientes. Requiere rol ADMIN.',
  })
  resumePaymentAccount(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('provider', new ParseEnumPipe(PaymentGatewayProvider))
    provider: PaymentGatewayProvider,
  ): Promise<PaymentAccountStatusResponseDto> {
    return this.resumePaymentAccountService.execute(authUser, provider);
  }

  @Patch(':provider/preferred')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Sube la prioridad de esta pasarela por encima de las demas del restaurante. Requiere rol ADMIN.',
  })
  setPreferredPaymentAccount(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('provider', new ParseEnumPipe(PaymentGatewayProvider))
    provider: PaymentGatewayProvider,
  ): Promise<PaymentAccountStatusResponseDto> {
    return this.setPreferredPaymentAccountService.execute(authUser, provider);
  }

  @Post('transbank')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Conecta manualmente la cuenta Transbank Webpay Mall del restaurante autenticado con su childCommerceCode. Requiere rol ADMIN.',
  })
  connectTransbankAccount(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: ConnectTransbankAccountDto,
  ): Promise<PaymentAccountStatusResponseDto> {
    return this.connectTransbankAccountService.execute(authUser, dto);
  }

  @Get('transbank')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Retorna el estado de la cuenta Transbank del restaurante autenticado, sin exponer la llave de plataforma.',
  })
  getTransbankStatus(
    @CurrentAuthUser() authUser: JwtPayload,
  ): Promise<PaymentAccountStatusResponseDto | null> {
    return this.getTransbankAccountStatusService.execute(authUser);
  }

  @Delete('transbank')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Desconecta la cuenta Transbank del restaurante autenticado. Requiere rol ADMIN.',
  })
  disconnectTransbankAccount(
    @CurrentAuthUser() authUser: JwtPayload,
  ): Promise<void> {
    return this.disconnectTransbankAccountService.execute(authUser);
  }

  @Post('transbank/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Recibe el retorno POST de Transbank Webpay tras el pago del cliente (token_ws, TBK_TOKEN o ninguno) y confirma o falla el intento asociado. Publico, sin guards: Transbank redirige el navegador del cliente y no puede mandar Authorization.',
  })
  confirmTransbankReturn(
    @Body() body: TransbankReturnDto,
  ): Promise<ConfirmRedirectPaymentResponseDto> {
    return this.confirmRedirectPaymentService.execute({
      tokenWs: body.token_ws,
      tbkToken: body.TBK_TOKEN,
    });
  }
}
