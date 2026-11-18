import { buildOpenTabRow } from './get-open-tabs.service';
import { buildSalesByMethod } from './get-sales-by-method.service';
import { buildSalesByStaff } from './get-sales-by-staff.service';
import {
  buildHourWeekday,
  buildPeriods,
  sumTimeRows,
} from './get-sales-by-time.service';
import {
  buildDeltas,
  buildKpiBlock,
  previousScope,
} from './get-summary-kpis.service';
import { addBusinessDays, buildTips } from './get-tips-report.service';
import { EMPTY_FILTERS, type ReportScope } from './report-types';

describe('buildSalesByMethod', () => {
  const records = [
    {
      method: 'CASH',
      payments: 3,
      bills: 3,
      amount: '6000',
      tip: '500',
      refunded: '1000',
    },
    {
      method: 'CREDIT_CARD',
      payments: 1,
      bills: 1,
      amount: '3000',
      tip: '0',
      refunded: '0',
    },
    {
      method: 'SIN_CLASIFICAR',
      payments: 1,
      bills: 1,
      amount: '1000',
      tip: '0',
      refunded: '0',
    },
  ];

  it('derives net per row, orders by net and shares it over the net total', () => {
    const { rows, totals } = buildSalesByMethod(records);

    expect(rows.map((row) => [row.method, row.net, row.share])).toEqual([
      ['CASH', '5000', 55.56],
      ['CREDIT_CARD', '3000', 33.33],
      ['SIN_CLASIFICAR', '1000', 11.11],
    ]);
    expect(totals).toEqual({
      count: 5,
      amount: '10000',
      tip: '500',
      refunded: '1000',
      net: '9000',
    });
    expect(rows[2].label).toBe('Sin clasificar');
  });

  it('returns zero totals and no rows when nothing was sold', () => {
    expect(buildSalesByMethod([])).toEqual({
      rows: [],
      totals: { count: 0, amount: '0', tip: '0', refunded: '0', net: '0' },
    });
  });
});

describe('buildSalesByStaff', () => {
  it('computes average ticket and tip per bill with the labels of the unassigned groups', () => {
    const { rows, totals } = buildSalesByStaff([
      {
        staff_id: 's1',
        online: false,
        name: 'Ana',
        bills: 2,
        guests: 5,
        amount: '10001',
        tip: '1000',
        refunded: '0',
      },
      {
        staff_id: null,
        online: true,
        name: null,
        bills: 1,
        guests: 1,
        amount: '2000',
        tip: '0',
        refunded: '0',
      },
      {
        staff_id: null,
        online: false,
        name: null,
        bills: 1,
        guests: 2,
        amount: '999',
        tip: '0',
        refunded: '0',
      },
    ]);

    expect(
      rows.map((row) => [row.name, row.averageTicket, row.tipPerBill]),
    ).toEqual([
      ['Ana', '5001', '500'],
      ['QR/Online', '2000', '0'],
      ['Sin asignar', '999', '0'],
    ]);
    expect(totals).toEqual({
      bills: 4,
      guests: 8,
      amount: '13000',
      refunded: '0',
      net: '13000',
      tip: '1000',
      averageTicket: '3250',
      tipPerBill: '250',
    });
  });
});

describe('refunds in staff and time reports', () => {
  it('subtracts refunds from the staff net and the average ticket', () => {
    const { rows, totals } = buildSalesByStaff([
      {
        staff_id: 's1',
        online: false,
        name: 'Ana',
        bills: 2,
        guests: 4,
        amount: '10000',
        tip: '500',
        refunded: '2000',
      },
      {
        staff_id: 's2',
        online: false,
        name: 'Beto',
        bills: 0,
        guests: 0,
        amount: '0',
        tip: '0',
        refunded: '1000',
      },
    ]);

    expect(
      rows.map((row) => [row.refunded, row.net, row.averageTicket]),
    ).toEqual([
      ['2000', '8000', '4000'],
      ['1000', '-1000', '0'],
    ]);
    expect(totals).toMatchObject({ refunded: '3000', net: '7000' });
  });

  it('puts refunds in their own bucket and the heatmap shows net amounts', () => {
    const { rows, heatmap } = buildHourWeekday(
      [
        {
          weekday: 3,
          hour: 12,
          bills: 1,
          guests: 2,
          amount: '5000',
          tip: '0',
          refunded: '1000',
        },
        {
          weekday: 4,
          hour: 9,
          bills: 0,
          guests: 0,
          amount: '0',
          tip: '0',
          refunded: '700',
        },
      ],
      'hour',
    );

    expect(rows[12]).toMatchObject({
      amount: '5000',
      refunded: '1000',
      net: '4000',
    });
    expect(rows[9]).toMatchObject({ bills: 0, refunded: '700', net: '-700' });
    expect(heatmap?.amount[2][12]).toBe('4000');
    expect(heatmap?.amount[3][9]).toBe('-700');
    expect(sumTimeRows(rows)).toMatchObject({ refunded: '1700', net: '3300' });
  });
});

describe('time buckets', () => {
  it('fills the 24 hours and the 7 weekdays and places the cell in the Monday first matrix', () => {
    const records = [
      {
        weekday: 3,
        hour: 12,
        bills: 2,
        guests: 4,
        amount: '20000',
        tip: '1000',
        refunded: '0',
      },
      {
        weekday: 7,
        hour: 10,
        bills: 1,
        guests: 1,
        amount: '2250',
        tip: '250',
        refunded: '0',
      },
    ];
    const hours = buildHourWeekday(records, 'hour');
    const weekdays = buildHourWeekday(records, 'weekday');

    expect(hours.rows).toHaveLength(24);
    expect(hours.rows[12]).toMatchObject({
      key: '12',
      label: '12:00',
      amount: '20000',
      averageTicket: '10000',
    });
    expect(weekdays.rows.map((row) => row.label)[0]).toBe('Lunes');
    expect(weekdays.rows[6]).toMatchObject({ key: '7', amount: '2250' });
    expect(hours.heatmap?.amount[2][12]).toBe('20000');
    expect(hours.heatmap?.bills[6][10]).toBe(1);
    expect(sumTimeRows(hours.rows)).toMatchObject({
      amount: '22250',
      bills: 3,
      tip: '1250',
    });
  });

  it('fills the empty days and months of the range', () => {
    const days = buildPeriods(
      [
        {
          bucket: '2026-07-12',
          bills: 1,
          guests: 1,
          amount: '500',
          tip: '0',
          refunded: '0',
        },
      ],
      'day',
      '2026-07-11',
      '2026-07-13',
    );
    const months = buildPeriods([], 'month', '2026-11-20', '2027-01-03');

    expect(days.map((row) => [row.key, row.label, row.amount])).toEqual([
      ['2026-07-11', '11-07-2026', '0'],
      ['2026-07-12', '12-07-2026', '500'],
      ['2026-07-13', '13-07-2026', '0'],
    ]);
    expect(months.map((row) => row.key)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });
});

describe('addBusinessDays', () => {
  it.each([
    ['2026-07-15', 7, '2026-07-24'],
    ['2026-07-12', 7, '2026-07-21'],
    ['2026-07-17', 1, '2026-07-20'],
    ['2026-07-18', 5, '2026-07-24'],
  ])('%s plus %i business days is %s', (from, days, expected) => {
    expect(addBusinessDays(from, days)).toBe(expected);
  });
});

describe('buildTips', () => {
  const days = [
    {
      staff_id: 'w1',
      name: 'Ana',
      day: '2026-07-14',
      bills: 1,
      sales: '10000',
      tip: '1000',
      returned: '0',
    },
    {
      staff_id: 'w1',
      name: 'Ana',
      day: '2026-07-15',
      bills: 1,
      sales: '5000',
      tip: '500',
      returned: '100',
    },
    {
      staff_id: null,
      name: null,
      day: '2026-07-15',
      bills: 1,
      sales: '2000',
      tip: '0',
      returned: '0',
    },
  ];
  const payouts = [
    {
      staff_id: 'w1',
      paid_day: '2026-07-14',
      card_tip: '600',
      card_tip_owed: '600',
      cash_tip: '400',
      total_tip: '1000',
    },
    {
      staff_id: 'w1',
      paid_day: '2026-07-15',
      card_tip: '300',
      card_tip_owed: '300',
      cash_tip: '0',
      total_tip: '500',
    },
  ];

  it('splits the tip by method and flags card tips past the seven business days', () => {
    const result = buildTips(days, payouts, '2026-07-24');
    const ana = result.byWaiter[0];

    expect(ana).toMatchObject({
      staffId: 'w1',
      tip: '1500',
      tipPercent: 10,
      returned: '100',
      tipOwed: '1400',
      cashTip: '400',
      cardTip: '900',
      otherTip: '200',
      cardTipOverdue: '600',
      cardTipPending: '300',
      oldestCardTipDate: '2026-07-14',
      oldestCardTipDueDate: '2026-07-23',
      oldestCardTipAgeDays: 10,
      payoutStatus: 'OVERDUE',
    });
    expect(result.byWaiter[1]).toMatchObject({
      name: 'Sin asignar',
      payoutStatus: 'NO_CARD_TIPS',
    });
    expect(result.byDay.map((row) => [row.date, row.tip, row.bills])).toEqual([
      ['2026-07-14', '1000', 1],
      ['2026-07-15', '500', 2],
    ]);
    expect(result.totals).toMatchObject({
      tip: '1500',
      sales: '17000',
      returned: '100',
      tipOwed: '1400',
      bills: 3,
    });
    expect(result.payout).toMatchObject({
      cardTipOverdue: '600',
      cardTipPending: '300',
      overdueWaiters: 1,
      asOf: '2026-07-24',
    });
  });

  it('keeps card tips pending while the due date has not passed', () => {
    const result = buildTips(days, payouts, '2026-07-23');

    expect(result.byWaiter[0]).toMatchObject({
      cardTipOverdue: '0',
      cardTipPending: '900',
      payoutStatus: 'PENDING',
    });
  });
});

describe('buildOpenTabRow', () => {
  const base = {
    session_id: 'aaaaaaaa-0000-4000-8000-0000000000a1',
    bill_id: null,
    ticket_number: null,
    is_counter: false,
    customer_label: null,
    guest_count: 2,
    session_status: 'OPEN',
    bill_status: null,
    table_name: 'Mesa 1',
    zone_name: null,
    waiter_name: null,
    opened_at: new Date('2026-07-15T12:00:00.000Z'),
    ended_at: null,
    close_reason: null,
    total: '15000',
    paid: '7000',
    pending: '8000',
    cancelled_orders: null,
    cancelled_amount: null,
  };

  it('alerts only above 180 minutes for open tabs', () => {
    const exact = buildOpenTabRow(
      base,
      'open',
      new Date('2026-07-15T15:00:00.000Z'),
    );
    const over = buildOpenTabRow(
      base,
      'open',
      new Date('2026-07-15T15:01:00.000Z'),
    );
    const abandoned = buildOpenTabRow(
      { ...base, ended_at: new Date('2026-07-15T18:00:00.000Z') },
      'abandoned',
      new Date('2026-07-16T12:00:00.000Z'),
    );

    expect([exact.ageMinutes, exact.alert]).toEqual([180, false]);
    expect([over.ageMinutes, over.alert]).toEqual([181, true]);
    expect([abandoned.ageMinutes, abandoned.alert]).toEqual([360, false]);
    expect(exact.orderNumber).toBe('0000A1');
    expect(exact).toMatchObject({
      total: '15000',
      paid: '7000',
      pending: '8000',
    });
  });
});

describe('summary kpis', () => {
  const record = {
    bills: 4,
    table_bills: 3,
    guests: 9,
    gross: '40000',
    tip: '4000',
    refunded: '5000',
  };

  it('subtracts refunds for the net sales and averages the net over the bills', () => {
    expect(buildKpiBlock(record, 5, 2)).toEqual({
      grossSales: '40000',
      refunded: '5000',
      netSales: '35000',
      tips: '4000',
      bills: 4,
      averageTicket: '8750',
      guests: 9,
      tablesTurnover: '0.30',
    });
    expect(buildKpiBlock(record, 0, 2).tablesTurnover).toBeNull();
  });

  it('computes absolute and percent deltas and no percent over a zero base', () => {
    const current = buildKpiBlock(record, 5, 2);
    const previous = buildKpiBlock(
      { ...record, gross: '20000', refunded: '0', bills: 0, table_bills: 0 },
      5,
      2,
    );
    const delta = buildDeltas(current, previous);

    expect(delta.netSales).toEqual({ absolute: '15000', percent: 75 });
    expect(delta.bills).toEqual({ absolute: '4', percent: null });
    expect(delta.tablesTurnover).toEqual({ absolute: '0.30', percent: null });
  });

  it('builds the previous range with the same length ending where the current one starts', () => {
    const scope: ReportScope = {
      branchId: 'b',
      timeZone: 'America/Santiago',
      from: '2026-07-14',
      to: '2026-07-16',
      start: new Date('2026-07-14T04:00:00.000Z'),
      end: new Date('2026-07-17T04:00:00.000Z'),
      cashierId: null,
      methods: [],
      cashierScoped: false,
      filters: EMPTY_FILTERS,
    };
    const previous = previousScope(scope);

    expect([previous.from, previous.to]).toEqual(['2026-07-11', '2026-07-13']);
    expect(previous.start.toISOString()).toBe('2026-07-11T04:00:00.000Z');
    expect(previous.end).toEqual(scope.start);
  });
});
