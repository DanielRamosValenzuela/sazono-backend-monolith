import { buildCashSessionRows } from './cash-session-rows';
import { buildCashSessionsReport } from './get-cash-sessions-report.service';

const base = {
  register_label: 'Caja 1',
  staff_id: 's1',
  name: 'Ana',
  opened_at: new Date('2026-11-18T12:00:00Z'),
  forced: false,
  closing_note: null,
};

describe('cash sessions report', () => {
  it('computes expected from float, sales and movements and totals differences by cashier', () => {
    const rows = buildCashSessionRows([
      {
        ...base,
        id: '1',
        status: 'CLOSED',
        closed_at: new Date('2026-11-18T20:00:00Z'),
        opening_float: 20000,
        cash_sales: 50000,
        movements: -5000,
        counted_cash: 64000,
        difference: -1000,
      },
      {
        ...base,
        id: '2',
        status: 'OPEN',
        closed_at: null,
        opening_float: 10000,
        cash_sales: 0,
        movements: 0,
        counted_cash: null,
        difference: null,
      },
    ]);
    const report = buildCashSessionsReport(rows);

    expect(rows[0].expectedCash).toBe('65000');
    expect(rows[1].expectedCash).toBe('10000');
    expect(report.totals).toMatchObject({
      sessions: 2,
      openSessions: 1,
      difference: '-1000',
    });
    expect(report.byCashier).toEqual([
      { staffUserId: 's1', name: 'Ana', sessions: 2, difference: '-1000' },
    ]);
  });
});
