import {
  buildBoletaLines,
  buildBoletaSnapshot,
  buildCreditNoteSnapshot,
  computeCreditNoteReferenceCode,
  isTaxSnapshot,
  sanitizeItemName,
  type SnapshotEmitter,
} from './tax-snapshot';

const emitter: SnapshotEmitter = {
  rut: '76.795.561-8',
  legalName: 'Restaurante Demo SpA',
  activity: 'Restaurantes',
  economicActivityCode: 561000,
  address: 'Calle 1',
  commune: 'Santiago',
  city: 'Santiago',
};

const baseBoleta = {
  idempotencyKey: 'boleta:bill-1',
  issueDate: '2026-11-19',
  billId: 'bill-1',
  billNumber: 12,
  branch: { id: 'b1', name: 'Local' },
  emitter,
  paymentMethod: 'CASH',
  tip: 1000,
};

describe('buildBoletaLines', () => {
  it('keeps exact lines and carries the discount', () => {
    const lines = buildBoletaLines(
      [
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
      9500,
    );

    expect(lines).toEqual([
      {
        name: 'Hamburguesa',
        quantity: 2,
        unitPrice: 3000,
        discount: 500,
        total: 5500,
      },
      {
        name: 'Bebida',
        quantity: 2,
        unitPrice: 2000,
        discount: 0,
        total: 4000,
      },
    ]);
  });

  it('collapses a line whose unit price does not multiply exactly', () => {
    const [line] = buildBoletaLines(
      [
        {
          description: 'Combo',
          quantity: 3,
          unitPrice: 3333.33,
          totalPrice: 10000,
          discountAmount: 0,
        },
      ],
      10000,
    );

    expect(line).toMatchObject({ quantity: 1, unitPrice: 10000, total: 10000 });
  });

  it('falls back to a single consumption line when lines do not add up', () => {
    const lines = buildBoletaLines(
      [
        {
          description: 'Plato',
          quantity: 1,
          unitPrice: 5000,
          totalPrice: 5000,
          discountAmount: 0,
        },
      ],
      6000,
    );

    expect(lines).toEqual([
      {
        name: 'Consumo restaurante',
        quantity: 1,
        unitPrice: 6000,
        discount: 0,
        total: 6000,
      },
    ]);
  });

  it('drops fully discounted lines', () => {
    const lines = buildBoletaLines(
      [
        {
          description: 'Cortesia',
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
          discountAmount: 1000,
        },
        {
          description: 'Plato',
          quantity: 1,
          unitPrice: 5000,
          totalPrice: 5000,
          discountAmount: 0,
        },
      ],
      5000,
    );

    expect(lines.map((line) => line.name)).toEqual(['Plato']);
  });
});

describe('sanitizeItemName', () => {
  it('trims, collapses spaces and limits to 80 characters', () => {
    expect(sanitizeItemName('  Pizza   grande  ')).toBe('Pizza grande');
    expect(sanitizeItemName('x'.repeat(120))).toHaveLength(80);
    expect(sanitizeItemName('   ')).toBe('Item');
  });
});

describe('buildBoletaSnapshot', () => {
  it('builds an immutable snapshot excluding the tip from the totals', () => {
    const snapshot = buildBoletaSnapshot({
      ...baseBoleta,
      items: [
        {
          description: 'Plato',
          quantity: 1,
          unitPrice: 10000,
          totalPrice: 10000,
          discountAmount: 0,
        },
      ],
      consumption: 10000,
      net: 8403,
      vat: 1597,
    });

    expect(snapshot).toMatchObject({
      version: 1,
      kind: 'BOLETA',
      totals: { gross: 10000, net: 8403, vat: 1597, exempt: 0 },
      tip: 1000,
      discountTotal: 0,
      paymentMethod: 'CASH',
      receiver: null,
    });
    expect(isTaxSnapshot(snapshot)).toBe(true);
  });

  it('rejects totals that do not add up', () => {
    expect(() =>
      buildBoletaSnapshot({
        ...baseBoleta,
        items: [],
        consumption: 10000,
        net: 8000,
        vat: 1597,
      }),
    ).toThrow('no cuadran');
  });

  it('rejects a zero amount', () => {
    expect(() =>
      buildBoletaSnapshot({
        ...baseBoleta,
        items: [],
        consumption: 0,
        net: 0,
        vat: 0,
      }),
    ).toThrow('mayor a cero');
  });
});

describe('buildCreditNoteSnapshot', () => {
  const input = {
    idempotencyKey: 'credit-note:rf1',
    issueDate: '2026-11-19',
    billId: 'bill-1',
    billNumber: 12,
    branch: { id: 'b1', name: 'Local' },
    emitter,
    refundId: 'rf1',
    reason: 'Plato frio',
    net: 4202,
    vat: 798,
    tip: 0,
    boletaTaxDocumentId: 'td1',
  };

  it('uses code 3 for a partial credit and 1 when the whole boleta is credited', () => {
    const partial = buildCreditNoteSnapshot({
      ...input,
      creditedConsumption: 5000,
      boletaTotal: 10000,
    });
    const full = buildCreditNoteSnapshot({
      ...input,
      net: 8403,
      vat: 1597,
      creditedConsumption: 10000,
      boletaTotal: 10000,
    });

    expect(partial.referenceCode).toBe(3);
    expect(full.referenceCode).toBe(1);
    expect(partial.totals.gross).toBe(5000);
    expect(partial.boletaTaxDocumentId).toBe('td1');
  });

  it('computeCreditNoteReferenceCode compares against the boleta total', () => {
    expect(computeCreditNoteReferenceCode(9999, 10000)).toBe(3);
    expect(computeCreditNoteReferenceCode(10000, 10000)).toBe(1);
  });
});

describe('isTaxSnapshot', () => {
  it('rejects unknown shapes', () => {
    expect(isTaxSnapshot(null)).toBe(false);
    expect(isTaxSnapshot({ version: 2, kind: 'BOLETA' })).toBe(false);
    expect(isTaxSnapshot({ version: 1, kind: 'OTHER' })).toBe(false);
  });
});
