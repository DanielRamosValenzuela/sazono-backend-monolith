import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type MercadoPagoEnvironment = 'sandbox' | 'production';

const MERCADOPAGO_DEFAULT_TIMEOUT_MS = 15000;
const MERCADOPAGO_WEBHOOK_DEFAULT_TOLERANCE_SECONDS = 300;

@Injectable()
export class MercadoPagoConfigService {
  private readonly logger = new Logger(MercadoPagoConfigService.name);
  readonly isEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isEnabled =
      this.configService.get<boolean>('MERCADOPAGO_ENABLED') ?? false;

    if (!this.isEnabled) {
      this.logger.warn(
        'Mercado Pago no esta habilitado (MERCADOPAGO_ENABLED=false) - la conexion de cuentas de pago queda deshabilitada.',
      );
    }
  }

  get clientId(): string {
    return this.getRequiredConfig('MERCADOPAGO_CLIENT_ID');
  }

  get clientSecret(): string {
    return this.getRequiredConfig('MERCADOPAGO_CLIENT_SECRET');
  }

  get environment(): MercadoPagoEnvironment {
    return (
      this.configService.get<MercadoPagoEnvironment>(
        'MERCADOPAGO_ENVIRONMENT',
      ) ?? 'sandbox'
    );
  }

  get oauthRedirectUri(): string {
    return this.getRequiredConfig('MERCADOPAGO_OAUTH_REDIRECT_URI');
  }

  get webhookUrl(): string {
    return this.getRequiredConfig('MERCADOPAGO_WEBHOOK_URL');
  }

  get webhookSecret(): string {
    return this.getRequiredConfig('MERCADOPAGO_WEBHOOK_SECRET');
  }

  get webhookToleranceSeconds(): number {
    return (
      this.configService.get<number>('MERCADOPAGO_WEBHOOK_TOLERANCE_SECONDS') ??
      MERCADOPAGO_WEBHOOK_DEFAULT_TOLERANCE_SECONDS
    );
  }

  get oauthUiReturnUrl(): string {
    return this.getRequiredConfig('PAYMENTS_OAUTH_UI_RETURN_URL');
  }

  get pkceEnabled(): boolean {
    return (
      this.configService.get<boolean>('MERCADOPAGO_OAUTH_PKCE_ENABLED') ?? false
    );
  }

  get applicationFeeBps(): number {
    return this.configService.get<number>('PAYMENTS_APPLICATION_FEE_BPS') ?? 0;
  }

  get qrGatewayRequired(): boolean {
    return (
      this.configService.get<boolean>('PAYMENTS_QR_GATEWAY_REQUIRED') ?? false
    );
  }

  get timeoutMs(): number {
    return (
      this.configService.get<number>('MERCADOPAGO_TIMEOUT_MS') ??
      MERCADOPAGO_DEFAULT_TIMEOUT_MS
    );
  }

  private getRequiredConfig(name: string): string {
    const value = this.configService.get<string>(name);

    if (!this.isEnabled || !value) {
      throw new Error(
        `Mercado Pago no esta configurado. Falta ${name} o MERCADOPAGO_ENABLED=false.`,
      );
    }

    return value;
  }
}
