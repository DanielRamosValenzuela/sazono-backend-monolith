import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  EmitOutcome,
  EmitRequest,
  PdfOutcome,
  ProviderFailure,
  RemoteDocumentState,
  StatusOutcome,
  TaxDocumentProviderPort,
  TaxProviderCredentials,
  VerifyOutcome,
} from '../../application/ports/tax-document-provider.port';
import { OpenFacturaClient } from './openfactura.client';
import {
  IDEMPOTENCY_REPLAY_CODE,
  classifyFailure,
  readErrorCode,
  readReplayToken,
  type ApiResponse,
} from './openfactura.errors';
import {
  TaxMappingError,
  mapBoletaPayload,
  mapCreditNotePayload,
  type OpenFacturaEmitter,
} from './openfactura.mapper';

export const OPENFACTURA_PROVIDER_NAME = 'openfactura';
const ORGANIZATION_CACHE_MS = 10 * 60 * 1000;
const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const PDF_TIMEOUT_MS = 60_000;

type OrganizationActivity = {
  giro?: unknown;
  codigoActividadEconomica?: unknown;
  actividadPrincipal?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function toInt(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function mapRemoteState(estado: string): RemoteDocumentState {
  const normalized = estado.trim().toLowerCase();

  if (normalized.startsWith('acept')) {
    return 'ISSUED';
  }

  if (normalized.startsWith('rechaz')) {
    return 'REJECTED';
  }

  return 'PENDING';
}

export function mapOrganizationToEmitter(body: unknown): OpenFacturaEmitter {
  const org = asRecord(body);
  const activities = Array.isArray(org.actividades)
    ? (org.actividades as OrganizationActivity[])
    : [];
  const main =
    activities.find((activity) => activity.actividadPrincipal === true) ??
    activities[0];

  return {
    rut: text(org.rut),
    legalName: text(org.razonSocial),
    activity: text(main?.giro),
    economicActivityCode: toInt(main?.codigoActividadEconomica),
    address: text(org.direccion),
    commune: text(org.comuna),
    city: text(org.ciudad),
    siiBranchCode: toInt(org.cdgSIISucur),
  };
}

@Injectable()
export class OpenFacturaTaxDocumentProvider implements TaxDocumentProviderPort {
  readonly providerName = OPENFACTURA_PROVIDER_NAME;
  private readonly organizationCache = new Map<
    string,
    { emitter: OpenFacturaEmitter; expiresAt: number }
  >();

  constructor(private readonly client: OpenFacturaClient) {}

  async verifyCredentials(
    credentials: TaxProviderCredentials,
  ): Promise<VerifyOutcome> {
    const response = await this.client.request(
      credentials,
      'GET',
      '/organization',
    );

    if (response.status !== 200) {
      return { kind: 'FAILED', ...classifyFailure(response, 'OTHER') };
    }

    const org = asRecord(response.body);
    const rut = text(org.rut);

    if (!rut) {
      return {
        kind: 'FAILED',
        ...this.unexpected('La respuesta del proveedor no incluye el RUT.'),
      };
    }

    const foliosAvailable: Record<string, number> = {};
    const folios = await this.client.request(
      credentials,
      'GET',
      '/organization/document',
    );

    if (folios.status === 200) {
      const documents = asRecord(folios.body).documentos;

      for (const entry of Array.isArray(documents) ? documents : []) {
        const row = asRecord(entry);
        const available = Number(row.disponibles);

        const code = row.dte;

        if (
          (typeof code === 'number' || typeof code === 'string') &&
          Number.isFinite(available)
        ) {
          foliosAvailable[String(code)] = available;
        }
      }
    }

    return {
      kind: 'VERIFIED',
      rut,
      legalName: text(org.razonSocial),
      foliosAvailable,
    };
  }

  async emit(request: EmitRequest): Promise<EmitOutcome> {
    const emitterOverride = await this.resolveEmitterOverride(
      request.credentials,
    );

    if (emitterOverride && 'failure' in emitterOverride) {
      return { kind: 'FAILED', ...emitterOverride.failure };
    }

    const override = emitterOverride ? emitterOverride.emitter : null;
    let payload: { response: string[]; dte: Record<string, unknown> };

    try {
      const { snapshot, reference } = request;

      if (snapshot.kind === 'BOLETA') {
        payload = mapBoletaPayload(snapshot, override);
      } else {
        if (!reference) {
          return {
            kind: 'FAILED',
            ...this.permanent(
              'MISSING_REFERENCE',
              'La nota de credito no tiene boleta de referencia emitida.',
            ),
          };
        }

        payload = mapCreditNotePayload(snapshot, reference, override);
      }
    } catch (error) {
      if (error instanceof TaxMappingError) {
        return {
          kind: 'FAILED',
          ...this.permanent('MISSING_FISCAL_DATA', error.message),
        };
      }

      throw error;
    }

    const response = await this.client.request(
      request.credentials,
      'POST',
      '/document',
      {
        body: payload,
        headers: { [IDEMPOTENCY_HEADER]: request.idempotencyKey },
      },
    );

    return this.readEmitResponse(response);
  }

  async getStatus(request: {
    credentials: TaxProviderCredentials;
    token: string;
  }): Promise<StatusOutcome> {
    const response = await this.client.request(
      request.credentials,
      'GET',
      `/document/${encodeURIComponent(request.token)}/status`,
    );

    if (response.status !== 200) {
      return { kind: 'FAILED', ...classifyFailure(response, 'STATUS') };
    }

    const body = asRecord(response.body);
    const estado = text(body.estado) ?? 'Pendiente';
    const state = mapRemoteState(estado);
    const folio = toInt(body.folio);

    if (state === 'ISSUED' && folio === null) {
      const json = await this.client.request(
        request.credentials,
        'GET',
        `/document/${encodeURIComponent(request.token)}/json`,
      );

      return {
        kind: 'STATE',
        state,
        providerStatus: estado,
        folio: this.readFolioFromJson(json),
      };
    }

    return { kind: 'STATE', state, providerStatus: estado, folio };
  }

  async fetchPdf(request: {
    credentials: TaxProviderCredentials;
    token: string;
  }): Promise<PdfOutcome> {
    const path = `/document/${encodeURIComponent(request.token)}/pdf`;
    let response = await this.client.request(request.credentials, 'GET', path, {
      timeoutMs: PDF_TIMEOUT_MS,
    });

    if (response.status >= 500) {
      response = await this.client.request(request.credentials, 'GET', path, {
        timeoutMs: PDF_TIMEOUT_MS,
      });
    }

    const pdf = asRecord(response.body).pdf;

    if (response.status !== 200 || typeof pdf !== 'string') {
      return { kind: 'FAILED', ...classifyFailure(response, 'OTHER') };
    }

    return { kind: 'PDF', data: Buffer.from(pdf, 'base64') };
  }

  private readEmitResponse(response: ApiResponse): EmitOutcome {
    if (response.status === 200) {
      const body = asRecord(response.body);
      const token = text(body.TOKEN);

      if (!token) {
        return {
          kind: 'FAILED',
          ...this.unexpected('La emision no devolvio token de documento.'),
        };
      }

      const rest = Object.fromEntries(
        Object.entries(body).filter(
          ([field]) => field !== 'TIMBRE' && field !== 'PDF',
        ),
      );

      return {
        kind: 'ACCEPTED',
        token,
        folio: toInt(body.FOLIO),
        timbre: text(body.TIMBRE),
        replayed: false,
        raw: rest,
      };
    }

    if (
      response.status === 400 &&
      readErrorCode(response.body) === IDEMPOTENCY_REPLAY_CODE
    ) {
      const token = readReplayToken(response.body);

      if (token) {
        return {
          kind: 'ACCEPTED',
          token,
          folio: null,
          timbre: null,
          replayed: true,
          raw: { TOKEN: token, replayed: true },
        };
      }
    }

    return { kind: 'FAILED', ...classifyFailure(response, 'EMIT') };
  }

  private readFolioFromJson(response: ApiResponse): number | null {
    if (response.status !== 200) {
      return null;
    }

    const body = asRecord(response.body);
    const idDoc = asRecord(asRecord(asRecord(body.json).Encabezado).IdDoc);

    return toInt(idDoc.Folio) ?? toInt(body.folio);
  }

  private async resolveEmitterOverride(
    credentials: TaxProviderCredentials,
  ): Promise<
    { emitter: OpenFacturaEmitter } | { failure: ProviderFailure } | null
  > {
    if (credentials.environment !== 'SANDBOX') {
      return null;
    }

    const cacheKey = createHash('sha256')
      .update(credentials.apiKey)
      .digest('hex');
    const cached = this.organizationCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return { emitter: cached.emitter };
    }

    const response = await this.client.request(
      credentials,
      'GET',
      '/organization',
    );

    if (response.status !== 200) {
      return { failure: classifyFailure(response, 'OTHER') };
    }

    const emitter = mapOrganizationToEmitter(response.body);
    this.organizationCache.set(cacheKey, {
      emitter,
      expiresAt: Date.now() + ORGANIZATION_CACHE_MS,
    });

    return { emitter };
  }

  private permanent(code: string, message: string): ProviderFailure {
    return {
      retryable: false,
      code,
      message,
      auth: false,
      retryAfterMs: null,
    };
  }

  private unexpected(message: string): ProviderFailure {
    return {
      retryable: true,
      code: 'UNEXPECTED_RESPONSE',
      message,
      auth: false,
      retryAfterMs: null,
    };
  }
}
