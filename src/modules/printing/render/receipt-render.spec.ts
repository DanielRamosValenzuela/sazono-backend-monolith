import {
  buildReceiptDocument,
  buildReprintDocument,
  buildVoidDocument,
  withDeliveryBanners,
} from '../domain/receipt-builder';
import type { ReceiptDocument } from '../domain/receipt-document';
import { encodeText } from './codepages';
import { renderEscPos, toHex } from './escpos.renderer';
import {
  pageWidthPx,
  receiptCss,
  receiptFontPx,
  renderHtmlDocument,
  renderHtmlFragment,
} from './html.renderer';
import { renderText } from './text.renderer';

const SENT_AT = new Date('2026-11-25T17:32:00.000Z');

function referenceDocument(
  overrides: Partial<Parameters<typeof buildReceiptDocument>[0]> = {},
): ReceiptDocument {
  return buildReceiptDocument(
    {
      stationName: 'pizza',
      displayNumber: '#01-023',
      sentAt: SENT_AT,
      timezone: 'America/Santiago',
      isCounter: false,
      ticketNumber: null,
      tableCode: '7',
      customerLabel: 'Pedro',
      orderNotes: 'sin sal en todo',
      isQrOrder: false,
      staff: { firstName: 'Juanita', lastName: 'Cajero' },
      items: [
        {
          quantity: 1,
          name: 'Pizza 3 quesos',
          notes: 'sin oregano',
          options: ['Masa > Delgada'],
        },
        {
          quantity: 2,
          name: 'pizza hawaiana',
          notes: null,
          options: ['Extra > Queso'],
        },
      ],
      ...overrides,
    },
    { copies: 1 },
  );
}

const ART_32 = [
  '         *** pizza ***          ',
  '            #01-023             ',
  '25/11/2026 14:32          MESA 7',
  'CAJERO, JUANITA                 ',
  'Cliente: Pedro                  ',
  '................................',
  'NOTA PEDIDO: sin sal en todo    ',
  '................................',
  '1 x Pizza 3 quesos              ',
  '     Masa > Delgada             ',
  '     * sin oregano              ',
  '2 x pizza hawaiana              ',
  '     Extra > Queso              ',
  '................................',
  '(corte)                         ',
];

const ART_48 = [
  '                 *** pizza ***                  ',
  '                    #01-023                     ',
  '25/11/2026 14:32                          MESA 7',
  'CAJERO, JUANITA                   Cliente: Pedro',
  '................................................',
  'NOTA PEDIDO: sin sal en todo                    ',
  '................................................',
  '1 x Pizza 3 quesos                              ',
  '     Masa > Delgada                             ',
  '     * sin oregano                              ',
  '2 x pizza hawaiana                              ',
  '     Extra > Queso                              ',
  '................................................',
  '(corte)                         '.padEnd(48),
];

describe('reference ticket', () => {
  it('renders exactly the 58 mm art of the design doc', () => {
    const rows = renderText(referenceDocument(), 32)
      .split('\n')
      .map((row) => row.padEnd(32));

    expect(rows).toEqual(ART_32);
  });

  it('renders exactly the 80 mm art of the design doc', () => {
    const rows = renderText(referenceDocument(), 48)
      .split('\n')
      .map((row) => row.padEnd(48));

    expect(rows).toEqual(ART_48);
  });

  it('uses the restaurant timezone for the date', () => {
    const winter = referenceDocument({
      sentAt: new Date('2026-07-01T17:32:00.000Z'),
    });

    expect(winter.meta.printedAtLabel).toBe('01/07/2026 13:32');
    expect(referenceDocument().meta.printedAtLabel).toBe('25/11/2026 14:32');
  });

  it('prints the counter number and QR cashier label', () => {
    const doc = referenceDocument({
      isCounter: true,
      ticketNumber: 12,
      staff: null,
      isQrOrder: true,
      customerLabel: null,
    });

    expect(doc.meta.placeLabel).toBe('#12');
    expect(doc.meta.staffLabel).toBe('CLIENTE QR');
    expect(renderText(doc, 32)).toContain('CLIENTE QR');
  });

  it('shrinks the header when the station name does not fit doubled', () => {
    const doc = referenceDocument({ stationName: 'Barra de coctelerias' });
    const layoutText = renderText(doc, 32).split('\n')[0];

    expect(layoutText.trim()).toBe('*** Barra de coctelerias ***');

    const bytes = toHex(
      renderEscPos(doc, { columns: 32, codepage: 'cp858', copies: 1 }),
    );

    expect(bytes).not.toContain(
      '1d 21 11 ' + toHex(Uint8Array.from(encodeText('*** Barra', 'cp858'))),
    );
  });

  it('wraps long names with a five space continuation', () => {
    const doc = referenceDocument({
      items: [
        {
          quantity: 3,
          name: 'Hamburguesa doble con queso cheddar y tocino',
          notes: null,
          options: [],
        },
      ],
    });
    const rows = renderText(doc, 32).split('\n');
    const start = rows.findIndex((r) => r.startsWith('3 x'));

    expect(rows[start]).toBe('3 x Hamburguesa doble con queso');
    expect(rows[start + 1]).toBe('     cheddar y tocino');
  });
});

describe('ESC/POS golden bytes', () => {
  const simple = buildReceiptDocument(
    {
      stationName: 'Cocina',
      displayNumber: '#02-001',
      sentAt: SENT_AT,
      timezone: 'America/Santiago',
      isCounter: false,
      ticketNumber: null,
      tableCode: '1',
      customerLabel: null,
      orderNotes: null,
      isQrOrder: false,
      staff: { firstName: 'Ana', lastName: 'Perez' },
      items: [
        {
          quantity: 1,
          name: 'Ñoquis a la crema',
          notes: null,
          options: ['Salsa > Pesto'],
        },
      ],
    },
    { copies: 1 },
  );

  it('starts with init and CP858 selection and ends with a partial cut', () => {
    const bytes = renderEscPos(simple, { columns: 32, codepage: 'cp858' });
    const hex = toHex(bytes);

    expect(hex.startsWith('1b 40 1b 74 13')).toBe(true);
    expect(hex.endsWith('1b 64 02 1d 56 42 00')).toBe(true);
  });

  it('encodes enie and accents in CP858', () => {
    expect(encodeText('ñÑáéíóúü¿¡', 'cp858')).toEqual([
      0xa4, 0xa5, 0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0x81, 0xa8, 0xad,
    ]);
    expect(encodeText('Ñ', 'windows1252')).toEqual([0xd1]);
    expect(encodeText('Á', 'cp437')).toEqual([0x41]);
    expect(encodeText('😀', 'cp858')).toEqual([0x3f]);
  });

  it('uses double size and bold for the header and number', () => {
    const hex = toHex(renderEscPos(simple, { columns: 32, codepage: 'cp858' }));

    expect(hex).toContain('1b 61 01 1b 45 01 1d 21 11');
  });

  it('matches the stored golden for a simple 58 mm ticket', () => {
    const hex = toHex(renderEscPos(simple, { columns: 32, codepage: 'cp858' }));
    const text = (value: string) =>
      toHex(Uint8Array.from(encodeText(value, 'cp858')));
    const expected = [
      '1b 40 1b 74 13',
      `1b 61 01 1b 45 01 1d 21 11 ${text('*** Cocina ***')} 0a 1d 21 00 1b 45 00 1b 61 00`,
      `1b 61 01 1b 45 01 1d 21 11 ${text('#02-001')} 0a 1d 21 00 1b 45 00 1b 61 00`,
      `1b 61 00 1b 45 00 1d 21 00 ${text('25/11/2026 14:32          MESA 1')} 0a 1d 21 00 1b 45 00 1b 61 00`,
      `1b 61 00 1b 45 00 1d 21 00 ${text('PEREZ, ANA')} 0a 1d 21 00 1b 45 00 1b 61 00`,
      `1b 61 00 1b 45 00 1d 21 00 ${text('.'.repeat(32))} 0a 1d 21 00 1b 45 00 1b 61 00`,
      `1b 61 00 1b 45 00 1d 21 00 ${text('1 x Ñoquis a la crema')} 0a 1d 21 00 1b 45 00 1b 61 00`,
      `1b 61 00 1b 45 00 1d 21 00 ${text('     Salsa > Pesto')} 0a 1d 21 00 1b 45 00 1b 61 00`,
      `1b 61 00 1b 45 00 1d 21 00 ${text('.'.repeat(32))} 0a 1d 21 00 1b 45 00 1b 61 00`,
      '1b 64 02 1d 56 42 00',
    ].join(' ');

    expect(hex).toBe(expected);
    expect(hex).toContain('a5 6f 71 75 69 73');
  });

  it('honours custom ESC t id, no cut, drawer and copies', () => {
    const hex = toHex(
      renderEscPos(simple, {
        columns: 32,
        codepage: 'windows1252',
        escTCodepageId: 40,
        autoCut: false,
        cashDrawer: true,
        copies: 2,
      }),
    );

    expect(hex.startsWith('1b 40 1b 74 28 1b 70 00 19 fa')).toBe(true);
    expect(hex).not.toContain('1d 56');
    expect(hex.split('1b 40').length - 1).toBe(2);
  });

  it('renders every layout width without exceeding the columns', () => {
    for (const columns of [32, 35, 42, 48]) {
      const rows = renderText(referenceDocument(), columns).split('\n');

      expect(rows.every((row) => row.length <= columns)).toBe(true);
    }
  });
});

describe('document variants', () => {
  it('adds late and retry banners at delivery', () => {
    const doc = referenceDocument();
    const late = withDeliveryBanners(doc, {
      now: new Date(SENT_AT.getTime() + 11 * 60_000),
      attempts: 2,
      retryUncertain: true,
      lateMinutes: 10,
    });

    expect(late.banners).toEqual([
      '** ATRASADA, pedido 14:32 **',
      '(REINTENTO)',
    ]);
    expect(
      withDeliveryBanners(doc, {
        now: SENT_AT,
        attempts: 2,
        retryUncertain: false,
        lateMinutes: 10,
      }).banners,
    ).toEqual([]);
  });

  it('skips the late banner for reprints and manual retries', () => {
    const doc = referenceDocument();
    const input = {
      now: new Date(SENT_AT.getTime() + 60 * 60_000),
      attempts: 1,
      retryUncertain: false,
      lateMinutes: 10,
    };
    const reprint = buildReprintDocument(doc, {
      reprintNumber: 1,
      now: input.now,
      timezone: 'America/Santiago',
      byLabel: 'PEREZ, ANA',
    });

    expect(
      withDeliveryBanners(reprint, input).banners.some((b) =>
        b.includes('ATRASADA'),
      ),
    ).toBe(false);
    expect(
      withDeliveryBanners(doc, { ...input, manualRetry: true }).banners,
    ).toEqual([]);
    expect(withDeliveryBanners(doc, input).banners).toHaveLength(1);
  });

  it('marks reprints once and voids with reason and actor', () => {
    const doc = referenceDocument();
    const reprint = buildReprintDocument(doc, {
      reprintNumber: 1,
      now: SENT_AT,
      timezone: 'America/Santiago',
      byLabel: 'PEREZ, ANA',
    });
    const again = buildReprintDocument(reprint, {
      reprintNumber: 2,
      now: SENT_AT,
      timezone: 'America/Santiago',
      byLabel: 'PEREZ, ANA',
    });

    expect(again.banners.filter((b) => b.includes('REIMPRESO'))).toEqual([
      '*** REIMPRESO #2 ***',
    ]);

    const voided = buildVoidDocument(doc, {
      now: SENT_AT,
      timezone: 'America/Santiago',
      reason: 'Cliente se fue',
      byLabel: 'PEREZ, ANA',
    });
    const text = renderText(voided, 32);

    expect(voided.kind).toBe('VOID');
    expect(text).toContain('*** ANULADO ***');
    expect(text).toContain('#01-023');
    expect(text).toContain('Motivo: Cliente se fue');
    expect(text).toContain('Anulado por: PEREZ, ANA');
  });

  it('replaces characters outside the repertoire', () => {
    const doc = referenceDocument({
      items: [{ quantity: 1, name: 'Pizza 🍕', notes: null, options: [] }],
    });

    expect(doc.lines[0].name).toBe('Pizza ?');
  });
});

describe('HTML renderer', () => {
  it('escapes content and sets the page width', () => {
    const doc = referenceDocument({
      orderNotes: '<script>alert(1)</script>',
    });
    const html = renderHtmlDocument(doc, { columns: 32, paperWidthMm: 58 });

    expect(html).toContain('@page{size:58mm auto;margin:0}');
    expect(html).toContain('width:100%;max-width:219px');
    expect(html).toContain('font-size:11px');
    expect(html).toContain('.row{white-space:pre;overflow:visible}');
    expect(html).not.toContain('ch;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('derives the font size so the columns fit the page width', () => {
    expect(receiptFontPx({ columns: 32, paperWidthMm: 58 })).toBe(11);
    expect(receiptFontPx({ columns: 48, paperWidthMm: 80 })).toBe(10);
    expect(receiptCss({ columns: 48, paperWidthMm: 80 })).toContain(
      'width:100%;max-width:302px;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace;font-size:10px',
    );

    for (const [columns, mm] of [
      [32, 58],
      [35, 58],
      [42, 80],
      [48, 80],
    ]) {
      expect(
        receiptFontPx({ columns, paperWidthMm: mm }) * 0.6 * columns,
      ).toBeLessThanOrEqual(pageWidthPx(mm));
    }
  });

  it('repeats the receipt per copy', () => {
    const fragment = renderHtmlFragment(referenceDocument(), {
      columns: 48,
      paperWidthMm: 80,
      copies: 2,
    });

    expect(fragment.split('class="receipt"').length - 1).toBe(2);
  });
});
