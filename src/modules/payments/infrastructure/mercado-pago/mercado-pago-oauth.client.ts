import { Injectable } from '@nestjs/common';
import { MercadoPagoConfigService } from './mercado-pago-config.service';

export const MERCADOPAGO_OAUTH_AUTHORIZATION_URL =
  'https://auth.mercadopago.com/authorization';
export const MERCADOPAGO_OAUTH_TOKEN_URL =
  'https://api.mercadopago.com/oauth/token';
export const MERCADOPAGO_OAUTH_CREATION_DOCS_URL =
  'https://www.mercadopago.com.ar/developers/en/docs/security/oauth/creation';
export const MERCADOPAGO_OAUTH_TOKEN_DOCS_URL =
  'https://www.mercadopago.com.ar/developers/en/reference/authentication/oauth/_oauth_token/post';

export type MercadoPagoOAuthTokenResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope?: string;
  refreshToken?: string;
  userId?: number;
  publicKey?: string;
  liveMode: boolean;
};

export type BuildAuthorizationUrlInput = {
  state: string;
  codeChallenge?: string;
};

export class MercadoPagoOAuthError extends Error {}

type MercadoPagoOAuthTokenApiPayload = {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  refresh_token?: unknown;
  user_id?: unknown;
  public_key?: unknown;
  live_mode?: unknown;
  message?: unknown;
  error?: unknown;
};

@Injectable()
export class MercadoPagoOAuthClient {
  constructor(private readonly mercadoPagoConfig: MercadoPagoConfigService) {}

  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
    const url = new URL(MERCADOPAGO_OAUTH_AUTHORIZATION_URL);

    url.searchParams.set('client_id', this.mercadoPagoConfig.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('platform_id', 'mp');
    url.searchParams.set(
      'redirect_uri',
      this.mercadoPagoConfig.oauthRedirectUri,
    );
    url.searchParams.set('state', input.state);
    url.searchParams.set('scope', 'offline_access');

    if (this.mercadoPagoConfig.pkceEnabled && input.codeChallenge) {
      url.searchParams.set('code_challenge', input.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    return url.toString();
  }

  exchangeAuthorizationCode(
    code: string,
    codeVerifier?: string,
  ): Promise<MercadoPagoOAuthTokenResponse> {
    const body: Record<string, string> = {
      client_id: this.mercadoPagoConfig.clientId,
      client_secret: this.mercadoPagoConfig.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.mercadoPagoConfig.oauthRedirectUri,
    };

    if (this.mercadoPagoConfig.pkceEnabled && codeVerifier) {
      body.code_verifier = codeVerifier;
    }

    return this.postToken(body);
  }

  refreshAccessToken(
    refreshToken: string,
  ): Promise<MercadoPagoOAuthTokenResponse> {
    return this.postToken({
      client_id: this.mercadoPagoConfig.clientId,
      client_secret: this.mercadoPagoConfig.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  private async postToken(
    body: Record<string, string>,
  ): Promise<MercadoPagoOAuthTokenResponse> {
    const response = await fetch(MERCADOPAGO_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = (await response
      .json()
      .catch(() => null)) as MercadoPagoOAuthTokenApiPayload | null;

    if (!response.ok || !payload || typeof payload.access_token !== 'string') {
      const message =
        typeof payload?.message === 'string'
          ? payload.message
          : typeof payload?.error === 'string'
            ? payload.error
            : `HTTP ${response.status}`;

      throw new MercadoPagoOAuthError(
        `Mercado Pago rechazo el intercambio de tokens OAuth: ${message}`,
      );
    }

    return {
      accessToken: payload.access_token,
      tokenType:
        typeof payload.token_type === 'string' ? payload.token_type : 'bearer',
      expiresIn:
        typeof payload.expires_in === 'number' ? payload.expires_in : 0,
      scope: typeof payload.scope === 'string' ? payload.scope : undefined,
      refreshToken:
        typeof payload.refresh_token === 'string'
          ? payload.refresh_token
          : undefined,
      userId: typeof payload.user_id === 'number' ? payload.user_id : undefined,
      publicKey:
        typeof payload.public_key === 'string' ? payload.public_key : undefined,
      liveMode: payload.live_mode === true,
    };
  }
}
