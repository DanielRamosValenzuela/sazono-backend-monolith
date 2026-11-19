import type { TaxDocumentsConfigService } from '../../application/tax-documents-config.service';
import type { TaxProviderCredentials } from '../../application/ports/tax-document-provider.port';
import {
  buildBoletaSnapshot,
  buildCreditNoteSnapshot,
  type SnapshotEmitter,
} from '../../domain/tax-snapshot';
import { OpenFacturaClient } from './openfactura.client';
import {
  OpenFacturaTaxDocumentProvider,
  mapOrganizationToEmitter,
  mapRemoteState,
} from './openfactura-tax-document.provider';

const emitter: SnapshotEmitter = {
  rut: '76795561-8',
  legalName: 'Demo SpA',
  activity: 'Restaurantes',
  economicActivityCode: 561000,
  address: 'Calle 1',
  commune: 'Santiago',
  city: null,
};

const boleta = buildBoletaSnapshot({
  idempotencyKey: 'boleta:b1',
  issueDate: '2026-11-19',
  billId: 'b1',
  billNumber: 1,
  branch: { id: 'br', name: 'Local' },
  emitter,
  paymentMethod: null,
  items: [],
  consumption: 10000,
  net: 8403,
  vat: 1597,
  tip: 0,
});
const note = buildCreditNoteSnapshot({
  idempotencyKey: 'credit-note:r1',
  issueDate: '2026-11-19',
  billId: 'b1',
  billNumber: 1,
  branch: { id: 'br', name: 'Local' },
  emitter,
  refundId: 'r1',
  reason: 'x',
  creditedConsumption: 5000,
  net: 4202,
  vat: 798,
  tip: 0,
  boletaTaxDocumentId: 't1',
  boletaTotal: 10000,
});

const production: TaxProviderCredentials = {
  apiKey: 'prod-key-123456',
  environment: 'PRODUCTION',
};
const sandbox: TaxProviderCredentials = {
  apiKey: 'demo-key-123456',
  environment: 'SANDBOX',
};

type Reply = { status: number; body: unknown };

function build(replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...replies];
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const reply = queue.shift();

    if (!reply) {
      return Promise.reject(new TypeError('fetch failed'));
    }

    return Promise.resolve({
      status: reply.status,
      text: () => Promise.resolve(JSON.stringify(reply.body)),
    } as Response);
  });
  const config = {
    baseUrl: (environment: string) =>
      environment === 'PRODUCTION'
        ? 'https://api.example.test'
        : 'https://dev.example.test',
    timeoutMs: 5000,
  } as unknown as TaxDocumentsConfigService;
  const client = new OpenFacturaClient(config, fetchMock);

  return { provider: new OpenFacturaTaxDocumentProvider(client), calls };
}

describe('OpenFacturaTaxDocumentProvider.emit', () => {
  it('posts the payload with api key and idempotency headers and returns the folio', async () => {
    const { provider, calls } = build([
      { status: 200, body: { TOKEN: 'tok1', FOLIO: 734085, TIMBRE: 'PNG' } },
    ]);

    const outcome = await provider.emit({
      credentials: production,
      snapshot: boleta,
      idempotencyKey: 'boleta:b1',
      reference: null,
    });

    expect(outcome).toMatchObject({
      kind: 'ACCEPTED',
      token: 'tok1',
      folio: 734085,
      timbre: 'PNG',
      replayed: false,
    });
    expect(calls[0].url).toBe('https://api.example.test/v2/dte/document');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.apikey).toBe('prod-key-123456');
    expect(headers['Idempotency-Key']).toBe('boleta:b1');
    expect(
      JSON.parse(calls[0].init.body as string).dte.Encabezado.IdDoc.TipoDTE,
    ).toBe(39);
  });

  it('treats an OF-06 replay as accepted and keeps the token', async () => {
    const { provider } = build([
      {
        status: 400,
        body: {
          error: {
            code: 'OF-06',
            message: 'Este DTE ya fue emitido (Idempotency-Key)',
            details: [{ field: 'token', issue: 'tok-existing' }],
          },
        },
      },
    ]);

    const outcome = await provider.emit({
      credentials: production,
      snapshot: boleta,
      idempotencyKey: 'boleta:b1',
      reference: null,
    });

    expect(outcome).toMatchObject({
      kind: 'ACCEPTED',
      token: 'tok-existing',
      folio: null,
      replayed: true,
    });
  });

  it('classifies validation errors as permanent', async () => {
    const { provider } = build([
      {
        status: 400,
        body: {
          error: {
            code: 'OF-10',
            message: 'Validacion',
            details: [{ field: 'MntNeto', issue: 'Monto erroneo' }],
          },
        },
      },
    ]);

    const outcome = await provider.emit({
      credentials: production,
      snapshot: boleta,
      idempotencyKey: 'k',
      reference: null,
    });

    expect(outcome).toMatchObject({ kind: 'FAILED', retryable: false });
  });

  it('classifies network errors as retryable', async () => {
    const { provider } = build([]);

    const outcome = await provider.emit({
      credentials: production,
      snapshot: boleta,
      idempotencyKey: 'k',
      reference: null,
    });

    expect(outcome).toMatchObject({
      kind: 'FAILED',
      retryable: true,
      code: 'NETWORK',
    });
  });

  it('fails permanently without calling the provider when fiscal data is missing', async () => {
    const { provider, calls } = build([]);

    const outcome = await provider.emit({
      credentials: production,
      snapshot: { ...boleta, emitter: { ...emitter, address: null } },
      idempotencyKey: 'k',
      reference: null,
    });

    expect(outcome).toMatchObject({
      kind: 'FAILED',
      retryable: false,
      code: 'MISSING_FISCAL_DATA',
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses a credit note without a reference', async () => {
    const { provider } = build([]);

    const outcome = await provider.emit({
      credentials: production,
      snapshot: note,
      idempotencyKey: 'k',
      reference: null,
    });

    expect(outcome).toMatchObject({
      kind: 'FAILED',
      code: 'MISSING_REFERENCE',
    });
  });

  it('uses the demo organization as emitter in sandbox', async () => {
    const { provider, calls } = build([
      {
        status: 200,
        body: {
          rut: '76795561-8',
          razonSocial: 'HAULMER CHILE SPA',
          direccion: 'A PRAT 545 DP 2',
          comuna: 'Curico',
          ciudad: '',
          cdgSIISucur: '81303347',
          actividades: [
            {
              giro: 'SOFTWARE',
              codigoActividadEconomica: '641990',
              actividadPrincipal: true,
            },
          ],
        },
      },
      { status: 200, body: { TOKEN: 't', FOLIO: 1 } },
    ]);

    await provider.emit({
      credentials: sandbox,
      snapshot: {
        ...boleta,
        emitter: { ...emitter, rut: '11.111.111-1' },
      },
      idempotencyKey: 'k',
      reference: null,
    });

    expect(calls[0].url).toBe('https://dev.example.test/v2/dte/organization');
    const sent = JSON.parse(calls[1].init.body as string) as {
      dte: { Encabezado: { Emisor: Record<string, unknown> } };
    };
    expect(sent.dte.Encabezado.Emisor).toMatchObject({
      RUTEmisor: '76795561-8',
      RznSocEmisor: 'HAULMER CHILE SPA',
      CdgSIISucur: 81303347,
    });
  });
});

describe('OpenFacturaTaxDocumentProvider.getStatus and fetchPdf', () => {
  it('maps Aceptado to ISSUED and Rechazado to REJECTED', async () => {
    const accepted = build([
      { status: 200, body: { estado: 'Aceptado', folio: '734085' } },
    ]);
    const rejected = build([{ status: 200, body: { estado: 'Rechazado' } }]);
    const pending = build([{ status: 200, body: { estado: 'Pendiente' } }]);

    await expect(
      accepted.provider.getStatus({ credentials: production, token: 't' }),
    ).resolves.toMatchObject({ state: 'ISSUED', folio: 734085 });
    await expect(
      rejected.provider.getStatus({ credentials: production, token: 't' }),
    ).resolves.toMatchObject({ state: 'REJECTED' });
    await expect(
      pending.provider.getStatus({ credentials: production, token: 't' }),
    ).resolves.toMatchObject({ state: 'PENDING' });
  });

  it('reads the folio from the json endpoint when the status has none', async () => {
    const { provider, calls } = build([
      { status: 200, body: { estado: 'Aceptado', token: 't' } },
      {
        status: 200,
        body: { json: { Encabezado: { IdDoc: { Folio: '734090' } } } },
      },
    ]);

    await expect(
      provider.getStatus({ credentials: production, token: 't' }),
    ).resolves.toMatchObject({ state: 'ISSUED', folio: 734090 });
    expect(calls[1].url).toContain('/document/t/json');
  });

  it('returns the pdf bytes', async () => {
    const { provider } = build([
      {
        status: 200,
        body: { pdf: Buffer.from('%PDF-1.4').toString('base64') },
      },
    ]);

    const outcome = await provider.fetchPdf({
      credentials: production,
      token: 't',
    });

    expect(outcome.kind).toBe('PDF');
    expect(outcome.kind === 'PDF' && outcome.data.toString()).toBe('%PDF-1.4');
  });
});

describe('OpenFacturaTaxDocumentProvider.verifyCredentials', () => {
  it('returns the organization rut and available folios', async () => {
    const { provider } = build([
      { status: 200, body: { rut: '76795561-8', razonSocial: 'Demo' } },
      { status: 200, body: { documentos: [{ dte: 39, disponibles: 10 }] } },
    ]);

    await expect(provider.verifyCredentials(production)).resolves.toEqual({
      kind: 'VERIFIED',
      rut: '76795561-8',
      legalName: 'Demo',
      foliosAvailable: { '39': 10 },
    });
  });

  it('flags an invalid key as an auth failure', async () => {
    const { provider } = build([
      { status: 401, body: { statusCode: 401, message: 'invalid key' } },
    ]);

    await expect(provider.verifyCredentials(production)).resolves.toMatchObject(
      { kind: 'FAILED', auth: true },
    );
  });
});

describe('helpers', () => {
  it('maps remote states', () => {
    expect(mapRemoteState('Aceptado con Reparo')).toBe('ISSUED');
    expect(mapRemoteState('Pendiente')).toBe('PENDING');
    expect(mapRemoteState('Rechazado')).toBe('REJECTED');
  });

  it('maps the organization to an emitter', () => {
    expect(
      mapOrganizationToEmitter({
        rut: '1-9',
        razonSocial: 'X',
        direccion: 'D',
        comuna: 'C',
        cdgSIISucur: '5',
        actividades: [
          {
            giro: 'A',
            codigoActividadEconomica: '1',
            actividadPrincipal: false,
          },
          {
            giro: 'B',
            codigoActividadEconomica: '641990',
            actividadPrincipal: true,
          },
        ],
      }),
    ).toMatchObject({
      activity: 'B',
      economicActivityCode: 641990,
      siiBranchCode: 5,
    });
  });
});
