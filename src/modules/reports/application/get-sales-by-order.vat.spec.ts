import type {
  BillPaymentRecord,
  BillRowRecord,
  MethodTotalRecord,
} from '../infrastructure/reports.prisma.repository';
import {
  SALES_BY_ORDER_CSV_HEADERS,
  buildSalesByOrderRow,
  buildSalesByOrderTotals,
} from './get-sales-by-order.service';

const bill: BillRowRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  closed_at: new Date('2026-07-14T16:00:00.000Z'),
  ticket_number: null,
  bill_number: 12,
  receipt_type: null,
  receipt_folio: null,
  guest_count: 2,
  table_name: 'Mesa 1',
  zone_name: null,
  waiter_name: null,
};

const payment: BillPaymentRecord = {
  id: 'p1',
  bill_id: bill.id,
  amount: 13090,
  tip_amount: 1190,
  method: 'CASH',
  source: 'CASHIER',
  staff_name: 'Caro',
};

describe('sales by order VAT columns', () => {
  it('splits consumption into net and vat leaving the tip out', () => {
    const row = buildSalesByOrderRow(bill, [payment]);

    expect(row.total).toBe('11900');
    expect(row.netAmount).toBe('10000');
    expect(row.vatAmount).toBe('1900');
    expect(row.exemptAmount).toBe('0');
    expect(row.tip).toBe('1190');
    expect(row.billNumber).toBe('12');
    expect(row.receipt).toBeNull();
    expect(row.receiptNumber).toBeNull();
  });

  it('computes vat over the amount net of refunds', () => {
    const row = buildSalesByOrderRow(bill, [{ ...payment, refunded: 5950 }]);

    expect(row.net).toBe('5950');
    expect(row.netAmount).toBe('5000');
    expect(row.vatAmount).toBe('950');
  });

  it('reads the boleta from the tax document', () => {
    const row = buildSalesByOrderRow(
      { ...bill, receipt_type: 'BOLETA_AFECTA', receipt_folio: 345 },
      [payment],
    );

    expect(row.receipt).toBe('Boleta afecta');
    expect(row.receiptNumber).toBe('345');
  });

  it('adds vat to the totals and to the csv headers', () => {
    const methodTotals: MethodTotalRecord[] = [
      {
        method: 'CASH',
        payments: 1,
        consumption: 11900,
        tip: 1190,
        refunded: 0,
        refunded_tip: 0,
        bills: 1,
      },
    ];
    const totals = buildSalesByOrderTotals(1, methodTotals);

    expect(totals.netAmount).toBe('10000');
    expect(totals.vatAmount).toBe('1900');
    expect(SALES_BY_ORDER_CSV_HEADERS).toEqual(
      expect.arrayContaining([
        'IVA',
        'Exento',
        'N° cuenta',
        'Boleta',
        'N° boleta',
      ]),
    );
  });
});
