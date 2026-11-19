import {
  buildBoletaSnapshot,
  buildCreditNoteSnapshot,
  type SnapshotEmitter,
} from '../../domain/tax-snapshot';
import {
  TaxMappingError,
  mapBoletaPayload,
  mapCreditNotePayload,
  normalizeRutForProvider,
} from './openfactura.mapper';

const emitter: SnapshotEmitter = {
  rut: '76.795.561-8',
  legalName: 'Restaurante Demo SpA',
  activity: 'Restaurantes y servicio de comidas',
  economicActivityCode: 561000,
  address: 'Calle Falsa 123',
  commune: 'Santiago',
  city: 'Santiago',
};

const boleta = buildBoletaSnapshot({
  idempotencyKey: 'boleta:bill-1',
  issueDate: '2026-11-19',
  billId: 'bill-1',
  billNumber: 7,
  branch: { id: 'b1', name: 'Local' },
  emitter,
  paymentMethod: 'CASH',
  items: [
    {
      description: 'Hamburguesa',
      quantity: 2,
      unitPrice: 3000,
      totalPrice: 6000,
      discountAmount: 500,
    },
    {
      description: 'Bebida',
      quantity: 2,
      unitPrice: 2000,
      totalPrice: 4000,
      discountAmount: 0,
    },
  ],
  consumption: 9500,
  net: 7983,
  vat: 1517,
  tip: 777,
});

const creditNote = buildCreditNoteSnapshot({
  idempotencyKey: 'credit-note:rf1',
  issueDate: '2026-11-20',
  billId: 'bill-1',
  billNumber: 7,
  branch: { id: 'b1', name: 'Local' },
  emitter,
  refundId: 'rf1',
  reason: 'Plato frio',
  creditedConsumption: 5000,
  net: 4202,
  vat: 798,
  tip: 0,
  boletaTaxDocumentId: 'td1',
  boletaTotal: 9500,
});

describe('mapBoletaPayload', () => {
  it('maps a boleta 39 with the field names the sandbox accepts', () => {
    const payload = mapBoletaPayload(boleta, null);

    expect(payload.response).toEqual(['FOLIO', 'TIMBRE', 'PDF']);
    expect(payload.dte).toEqual({
      Encabezado: {
        IdDoc: { TipoDTE: 39, Folio: 0, FchEmis: '2026-11-19', IndServicio: 3 },
        Emisor: {
          RUTEmisor: '76795561-8',
          RznSocEmisor: 'Restaurante Demo SpA',
          GiroEmisor: 'Restaurantes y servicio de comidas',
          DirOrigen: 'Calle Falsa 123',
          CmnaOrigen: 'Santiago',
          CiudadOrigen: 'Santiago',
        },
        Receptor: { RUTRecep: '66666666-6' },
        Totales: { MntNeto: 7983, IVA: 1517, MntTotal: 9500 },
      },
      Detalle: [
        {
          NroLinDet: 1,
          NmbItem: 'Hamburguesa',
          QtyItem: 2,
          PrcItem: 3000,
          DescuentoMonto: 500,
          MontoItem: 5500,
        },
        {
          NroLinDet: 2,
          NmbItem: 'Bebida',
          QtyItem: 2,
          PrcItem: 2000,
          MontoItem: 4000,
        },
      ],
    });
  });

  it('never includes the tip in the document', () => {
    const payload = JSON.stringify(mapBoletaPayload(boleta, null));

    expect(payload).not.toContain('777');
    expect(payload).not.toContain('Propina');
  });

  it('uses the override emitter and its sii branch code', () => {
    const payload = mapBoletaPayload(boleta, {
      ...emitter,
      rut: '76795561-8',
      siiBranchCode: 81303347,
    });
    const encabezado = payload.dte.Encabezado as {
      Emisor: Record<string, unknown>;
    };

    expect(encabezado.Emisor.CdgSIISucur).toBe(81303347);
  });

  it('sends the receiver when a valid rut is present', () => {
    const payload = mapBoletaPayload(
      { ...boleta, receiver: { rut: '11.111.111-1', name: 'Cliente' } },
      null,
    );
    const encabezado = payload.dte.Encabezado as {
      Receptor: Record<string, unknown>;
    };

    expect(encabezado.Receptor).toEqual({
      RUTRecep: '11111111-1',
      RznSocRecep: 'Cliente',
    });
  });

  it('lists the missing fiscal data of the restaurant', () => {
    const incomplete = { ...boleta, emitter: { ...emitter, address: null } };

    expect(() => mapBoletaPayload(incomplete, null)).toThrow(TaxMappingError);
    expect(() => mapBoletaPayload(incomplete, null)).toThrow('legalAddress');
  });
});

describe('mapCreditNotePayload', () => {
  it('maps a nota de credito 61 with factura-style tags and the boleta reference', () => {
    const payload = mapCreditNotePayload(
      creditNote,
      { folio: 734085, issueDate: '2026-11-19' },
      null,
    );

    expect(payload.dte).toEqual({
      Encabezado: {
        IdDoc: { TipoDTE: 61, Folio: 0, FchEmis: '2026-11-20' },
        Emisor: {
          RUTEmisor: '76795561-8',
          RznSoc: 'Restaurante Demo SpA',
          GiroEmis: 'Restaurantes y servicio de comidas',
          Acteco: 561000,
          DirOrigen: 'Calle Falsa 123',
          CmnaOrigen: 'Santiago',
          CiudadOrigen: 'Santiago',
        },
        Receptor: { RUTRecep: '66666666-6', RznSocRecep: 'Consumidor final' },
        Totales: { MntNeto: 4202, TasaIVA: 19, IVA: 798, MntTotal: 5000 },
      },
      Detalle: [
        {
          NroLinDet: 1,
          NmbItem: 'Devolucion de consumo',
          QtyItem: 1,
          PrcItem: 4202,
          MontoItem: 4202,
        },
      ],
      Referencia: [
        {
          NroLinRef: 1,
          TpoDocRef: 39,
          FolioRef: 734085,
          FchRef: '2026-11-19',
          CodRef: 3,
          RazonRef: 'Plato frio',
        },
      ],
    });
  });

  it('requires the economic activity code', () => {
    const noCode = {
      ...creditNote,
      emitter: { ...emitter, economicActivityCode: null },
    };

    expect(() =>
      mapCreditNotePayload(noCode, { folio: 1, issueDate: '2026-11-19' }, null),
    ).toThrow('economicActivityCode');
  });

  it('limits the reason to the provider maximum', () => {
    const payload = mapCreditNotePayload(
      { ...creditNote, reason: 'x'.repeat(200) },
      { folio: 1, issueDate: '2026-11-19' },
      null,
    );
    const referencia = payload.dte.Referencia as { RazonRef: string }[];

    expect(referencia[0].RazonRef).toHaveLength(90);
  });
});

describe('normalizeRutForProvider', () => {
  it('removes dots and keeps the dash', () => {
    expect(normalizeRutForProvider('76.795.561-8')).toBe('76795561-8');
    expect(normalizeRutForProvider('12345678-k')).toBe('12345678-K');
    expect(normalizeRutForProvider('abc')).toBeNull();
  });
});
