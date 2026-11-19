import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { TaxDocumentsConfigService } from '../../application/tax-documents-config.service';
import type { TaxProviderCredentials } from '../../application/ports/tax-document-provider.port';
import { NETWORK_STATUS, type ApiResponse } from './openfactura.errors';
import { RateLimitWaitTooLongError, RequestRateLimiter } from './rate-limiter';

export const OPENFACTURA_FETCH = Symbol('OPENFACTURA_FETCH');
export const API_PREFIX = '/v2/dte';
export const API_KEY_HEADER = 'apikey';
export const RATE_LIMITED_STATUS = 429;

export type FetchFunction = typeof fetch;

@Injectable()
export class OpenFacturaClient {
  private readonly limiters = new Map<string, RequestRateLimiter>();

  constructor(
    private readonly config: TaxDocumentsConfigService,
    @Optional()
    @Inject(OPENFACTURA_FETCH)
    private readonly fetchImpl: FetchFunction = (
      ...args: Parameters<FetchFunction>
    ) => fetch(...args),
  ) {}

  private limiterFor(apiKey: string): RequestRateLimiter {
    const id = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
    const existing = this.limiters.get(id);

    if (existing) {
      return existing;
    }

    const created = new RequestRateLimiter();
    this.limiters.set(id, created);

    return created;
  }

  async request(
    credentials: TaxProviderCredentials,
    method: 'GET' | 'POST',
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
    } = {},
  ): Promise<ApiResponse> {
    try {
      await this.limiterFor(credentials.apiKey).acquire();
    } catch (error) {
      if (error instanceof RateLimitWaitTooLongError) {
        return {
          status: RATE_LIMITED_STATUS,
          body: {
            message: `Rate limit local. Try again in ${Math.ceil(error.waitMs / 1000)} seconds.`,
          },
        };
      }

      throw error;
    }

    const url = `${this.config.baseUrl(credentials.environment)}${API_PREFIX}${path}`;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          [API_KEY_HEADER]: credentials.apiKey,
          Accept: 'application/json',
          ...(options.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...options.headers,
        },
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? this.config.timeoutMs),
      });
      const text = await response.text();
      let body: unknown = text;

      try {
        body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
      } catch {
        body = text.slice(0, 500);
      }

      return { status: response.status, body };
    } catch (error) {
      return {
        status: NETWORK_STATUS,
        body: {
          message:
            error instanceof Error
              ? `Error de red hacia el proveedor: ${error.name}`
              : 'Error de red hacia el proveedor.',
        },
      };
    }
  }
}
