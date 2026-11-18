import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type {
  OrderDetailHeaderRecord,
  OrderDetailItemRecord,
  OrderDetailPaymentRecord,
  OrderDetailRefundRecord,
  ReportsPrismaRepository,
} from '../infrastructure/reports.prisma.repository';
import {
  GetOrderDetailService,
  buildOrderDetail,
} from './get-order-detail.service';
import type {
  BranchAccessScope,
  ReportScopeService,
} from './report-scope.service';

const BILL = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const authUser = {
  sub: 'auth-1',
  profileType: LoginProfileType.STAFF,
  profileId: 'staff-1',
  restaurantId: 'restaurant-1',
};

function header(
  extra: Partial<OrderDetailHeaderRecord> = {},
): OrderDetailHeaderRecord {
  return {
    id: BILL,
    status: 'PAID',
    subtotal_amount: '10000.00',
    tax_amount: '0.00',
    tip_amount: '0.00',
    total_amount: '10000.00',
    remaining_amount: '0.00',
    opened_at: new Date('2026-07-15T14:00:00.000Z'),
    closed_at: new Date('2026-07-15T17:00:00.000Z'),
    close_reason: null,
    ticket_number: null,
    guest_count: 3,
    customer_label: null,
    is_counter: false,
    session_status: 'CLOSED',
    session_opened_at: new Date('2026-07-15T14:00:00.000Z'),
    session_closed_at: new Date('2026-07-15T17:00:00.000Z'),
    session_close_reason: null,
    table_id: 'table-1',
    table_name: 'Mesa 1',
    zone_id: 'zone-1',
    zone_name: 'Terraza',
    waiter_id: 'waiter-1',
    waiter_name: 'Ana Mesera',
    opened_by_name: 'Ana Mesera',
    last_paid_at: new Date('2026-07-15T16:00:00.000Z'),
    ...extra,
  };
}

function item(
  extra: Partial<OrderDetailItemRecord> = {},
): OrderDetailItemRecord {
  return {
    id: 'item-1',
    order_id: 'order-1',
    order_status: 'DELIVERED',
    order_source: 'WAITER',
    order_created_at: new Date('2026-07-15T14:00:00.000Z'),
    order_notes: null,
    name: 'Cafe Latte',
    category_path: ['Cafe', 'Bebidas Calientes'],
    unit_price: '3000.00',
    quantity: 2,
    status: 'DELIVERED',
    notes: 'sin azucar',
    station_name: 'Barra',
    menu_item_id: 'menu-1',
    modifiers: [
      {
        name: 'Leche de almendra',
        price_delta: '500.00',
        path: ['Leche de almendra'],
        depth: 1,
      },
    ],
    ...extra,
  };
}

function payment(
  extra: Partial<OrderDetailPaymentRecord> = {},
): OrderDetailPaymentRecord {
  return {
    id: 'pay-1',
    method: 'CASH',
    provider: 'MANUAL',
    provider_reference: null,
    amount: '11000.00',
    tip_amount: '1000.00',
    status: 'PAID',
    paid_at: new Date('2026-07-15T16:00:00.000Z'),
    created_at: new Date('2026-07-15T16:00:00.000Z'),
    source: 'CASHIER',
    staff_user_id: ME,
    staff_name: 'Caro Cajera',
    ...extra,
  };
}

function refundRecord(
  extra: Partial<OrderDetailRefundRecord> = {},
): OrderDetailRefundRecord {
  return {
    id: 'refund-1',
    items: [
      {
        bill_item_id: 'bi-1',
        name: 'Pizza',
        quantity: 1,
        amount: '3000.00',
        kitchen_waste: false,
      },
    ],
    payment_id: 'pay-1',
    amount: '3000.00',
    tip_amount: '0.00',
    net_amount: '2521.00',
    vat_amount: '479.00',
    method: 'CASH_MANUAL',
    status: 'SUCCEEDED',
    reason_code: 'CUSTOMER_COMPLAINT',
    reason_text: 'Plato frio',
    requested_by_staff_user_id: ME,
    requested_by_name: 'Caro Cajera',
    approved_by_name: null,
    credit_note_status: 'PENDING',
    completed_at: new Date('2026-07-15T17:00:00.000Z'),
    ...extra,
  };
}

describe('buildOrderDetail', () => {
  it('builds the header, the lines with modifiers and the reconciliation of a fully paid bill', () => {
    const detail = buildOrderDetail(
      header(),
      [
        item(),
        item({
          id: 'item-2',
          name: 'Torta',
          category_path: ['Postres'],
          unit_price: '4000.00',
          quantity: 1,
          modifiers: [],
          notes: null,
        }),
      ],
      [payment()],
      'America/Santiago',
    );

    expect(detail).toMatchObject({
      billId: BILL,
      orderNumber: '111111',
      billStatus: 'PAID',
      timeZone: 'America/Santiago',
      table: { id: 'table-1', name: 'Mesa 1' },
      zone: { id: 'zone-1', name: 'Terraza' },
      waiter: { id: 'waiter-1', name: 'Ana Mesera' },
      cashiers: ['Caro Cajera'],
      guests: 3,
      paidAt: '2026-07-15T16:00:00.000Z',
    });
    expect(detail.items[0]).toMatchObject({
      name: 'Cafe Latte',
      quantity: 2,
      unitPrice: '3000',
      baseUnitPrice: '2500',
      modifiers: [
        {
          name: 'Leche de almendra',
          priceDelta: '500',
          path: ['Leche de almendra'],
          depth: 1,
        },
      ],
      modifiersTotal: '500',
      lineTotal: '6000',
      notes: 'sin azucar',
      categoryLabel: 'Cafe > Bebidas Calientes',
      cancelled: false,
      counted: true,
    });
    expect(detail.payments[0]).toMatchObject({
      method: 'CASH',
      methodLabel: 'Efectivo',
      amount: '10000',
      tip: '1000',
      total: '11000',
      cashier: 'Caro Cajera',
      caja: 'Caro Cajera',
    });
    expect(detail.totals).toMatchObject({
      itemsCount: 3,
      itemsTotal: '10000',
      paid: '10000',
      tip: '1000',
      collected: '11000',
      difference: '0',
      reconciled: true,
      paidPaymentsCount: 1,
    });
    expect(detail.flags).toMatchObject({
      partiallyPaid: false,
      abandoned: false,
      overpaid: false,
      hasCancelledItems: false,
      mixedMethods: false,
    });
  });

  it('flags cancelled lines and leaves them out of the sold total', () => {
    const detail = buildOrderDetail(
      header(),
      [
        item(),
        item({ id: 'item-3', name: 'Jugo', status: 'CANCELLED' }),
        item({
          id: 'item-4',
          name: 'Helado',
          order_id: 'order-2',
          order_status: 'AWAITING_PAYMENT',
          status: 'PENDING',
        }),
      ],
      [payment({ amount: '6000.00', tip_amount: '0.00' })],
      'America/Santiago',
    );
    const cancelled = detail.items.find((line) => line.name === 'Jugo');
    const unpaidOrder = detail.items.find((line) => line.name === 'Helado');

    expect(cancelled).toMatchObject({ cancelled: true, counted: false });
    expect(unpaidOrder).toMatchObject({ cancelled: false, counted: false });
    expect(detail.totals.itemsTotal).toBe('6000');
    expect(detail.totals.excludedItemsTotal).toBe('12000');
    expect(detail.flags.hasCancelledItems).toBe(true);
    expect(detail.orders.map((order) => order.id)).toEqual([
      'order-1',
      'order-2',
    ]);
  });

  it('marks a partially paid bill, the open balance and several cashiers', () => {
    const detail = buildOrderDetail(
      header({ status: 'PARTIALLY_PAID', remaining_amount: '5000.00' }),
      [item()],
      [
        payment({ amount: '1000.00', tip_amount: '0.00' }),
        payment({
          id: 'pay-2',
          method: 'CREDIT_CARD',
          amount: '0.00',
          tip_amount: '0.00',
          staff_name: 'Cami Cajero',
          staff_user_id: OTHER,
        }),
      ],
      'America/Santiago',
    );

    expect(detail.flags.partiallyPaid).toBe(true);
    expect(detail.flags.mixedMethods).toBe(true);
    expect(detail.totals.difference).toBe('5000');
    expect(detail.totals.reconciled).toBe(false);
    expect(detail.totals.remaining).toBe('5000');
    expect(detail.cashiers).toEqual(['Caro Cajera', 'Cami Cajero']);
  });

  it('flags abandoned bills, refunded and open payments, unclassified methods and QR caja', () => {
    const detail = buildOrderDetail(
      header({ status: 'ABANDONED', last_paid_at: null, closed_at: null }),
      [item()],
      [
        payment({
          id: 'pay-1',
          method: null,
          staff_name: null,
          staff_user_id: null,
          source: 'WEB_QR',
        }),
        payment({ id: 'pay-2', status: 'REFUNDED' }),
        payment({ id: 'pay-3', status: 'PENDING', paid_at: null }),
      ],
      'America/Santiago',
    );

    expect(detail.flags).toMatchObject({
      abandoned: true,
      hasUnclassifiedPayments: true,
      hasRefundedPayments: true,
      hasOpenPayments: true,
    });
    expect(detail.payments[0]).toMatchObject({
      method: 'SIN_CLASIFICAR',
      caja: 'QR/Online',
    });
    expect(detail.paidAt).toBeNull();
    expect(detail.closedAt).toBeNull();
    expect(detail.totals.paidPaymentsCount).toBe(1);
  });

  it('uses the counter ticket as order number and reports an overpayment', () => {
    const detail = buildOrderDetail(
      header({ ticket_number: 42, zone_id: null, zone_name: null }),
      [item({ unit_price: '1000.00', quantity: 1, modifiers: [] })],
      [payment({ amount: '3000.00', tip_amount: '0.00' })],
      'America/Santiago',
    );

    expect(detail.orderNumber).toBe('42');
    expect(detail.zone).toBeNull();
    expect(detail.flags.overpaid).toBe(true);
    expect(detail.totals.difference).toBe('-2000');
  });

  it('falls back to the uncategorized label for old lines without a snapshot', () => {
    const detail = buildOrderDetail(
      header(),
      [
        item({ category_path: [] }),
        item({ id: 'item-9', category_path: null }),
      ],
      [payment()],
      'America/Santiago',
    );

    expect(detail.items.map((line) => line.categoryLabel)).toEqual([
      '(Sin categoria)',
      '(Sin categoria)',
    ]);
  });
});

describe('buildOrderDetail refunds', () => {
  const refundedPayment = payment({
    refunded_amount: '3500.00',
    refunded_tip_amount: '500.00',
  });
  const build = (payments = [refundedPayment], bill = header()) =>
    buildOrderDetail(
      {
        ...bill,
        refunded_amount: '3500.00',
      },
      [item()],
      payments,
      'America/Santiago',
      [
        refundRecord(),
        refundRecord({
          id: 'refund-2',
          amount: '500.00',
          tip_amount: '500.00',
          net_amount: '0.00',
          vat_amount: '0.00',
        }),
      ],
    );

  it('shows lifetime refunded amounts and what is still refundable per payment', () => {
    const detail = build();

    expect(detail.payments[0]).toMatchObject({
      amount: '10000',
      tip: '1000',
      refunded: '3000',
      refundedTip: '500',
      refundable: { total: '7500', consumption: '7000', tip: '500' },
    });
  });

  it('lists the refunds and nets them in the totals without touching the reconciliation', () => {
    const detail = build();

    expect(detail.refunds).toHaveLength(2);
    expect(detail.refunds[0]).toMatchObject({
      items: [
        {
          billItemId: 'bi-1',
          name: 'Pizza',
          quantity: 1,
          amount: '3000',
          kitchenWaste: false,
        },
      ],
      id: 'refund-1',
      paymentId: 'pay-1',
      amount: '3000',
      tip: '0',
      net: '2521',
      vat: '479',
      method: 'CASH_MANUAL',
      reasonCode: 'CUSTOMER_COMPLAINT',
      requestedBy: 'Caro Cajera',
      approvedBy: null,
      creditNoteStatus: 'PENDING',
    });
    expect(detail.totals).toMatchObject({
      paid: '10000',
      collected: '11000',
      refunded: '3000',
      refundedTip: '500',
      refundedTotal: '3500',
      net: '7000',
    });
    expect(detail.flags.hasRefundedPayments).toBe(true);
    expect(detail.totals.difference).toBe(
      buildOrderDetail(header(), [item()], [payment()], 'America/Santiago')
        .totals.difference,
    );
  });

  it('has no refunds block content when nothing was refunded', () => {
    const detail = buildOrderDetail(
      header(),
      [item()],
      [payment()],
      'America/Santiago',
    );

    expect(detail.refunds).toEqual([]);
    expect(detail.totals).toMatchObject({
      refunded: '0',
      refundedTotal: '0',
      net: '10000',
    });
    expect(detail.flags.hasRefundedPayments).toBe(false);
    expect(detail.payments[0].refundable).toEqual({
      total: '11000',
      consumption: '10000',
      tip: '1000',
    });
  });

  it('reports nothing refundable for a payment that is not PAID', () => {
    const detail = build([payment({ status: 'PENDING' })]);

    expect(detail.payments[0].refundable).toEqual({
      total: '0',
      consumption: '0',
      tip: '0',
    });
  });
});

describe('GetOrderDetailService', () => {
  const resolveAccessMock = jest.fn();
  const findOrderDetailMock = jest.fn();
  const service = new GetOrderDetailService(
    { resolveAccess: resolveAccessMock } as unknown as ReportScopeService,
    {
      findOrderDetail: findOrderDetailMock,
    } as unknown as ReportsPrismaRepository,
  );
  const access = (
    extra: Partial<BranchAccessScope> = {},
  ): BranchAccessScope => ({
    timeZone: 'America/Santiago',
    cashierScoped: false,
    staffUserId: ME,
    todayStart: new Date('2026-07-15T04:00:00.000Z'),
    todayEnd: new Date('2026-07-16T04:00:00.000Z'),
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resolveAccessMock.mockResolvedValue(access());
    findOrderDetailMock.mockResolvedValue({
      header: header(),
      items: [item()],
      payments: [payment()],
    });
  });

  it('returns the detail of any bill of the branch for full access roles', async () => {
    const detail = await service.execute(authUser, 'branch-1', BILL);

    expect(findOrderDetailMock).toHaveBeenCalledWith('branch-1', BILL, null);
    expect(detail.billId).toBe(BILL);
  });

  it('answers 404 when the bill does not belong to the branch', async () => {
    findOrderDetailMock.mockResolvedValue({
      header: null,
      items: [],
      payments: [],
    });

    await expect(
      service.execute(authUser, 'branch-1', BILL),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a CASHIER open a bill they collected today', async () => {
    resolveAccessMock.mockResolvedValue(access({ cashierScoped: true }));

    await expect(
      service.execute(authUser, 'branch-1', BILL),
    ).resolves.toMatchObject({ billId: BILL });
  });

  it.each([
    ['collected by someone else', { staff_user_id: OTHER }],
    ['collected yesterday', { paid_at: new Date('2026-07-14T16:00:00.000Z') }],
    [
      'collected at the end of the day boundary',
      { paid_at: new Date('2026-07-16T04:00:00.000Z') },
    ],
    ['not paid', { status: 'PENDING' }],
    ['without paid date', { paid_at: null }],
  ])(
    'hides from a CASHIER a bill whose only payment was %s',
    async (_name, extra) => {
      resolveAccessMock.mockResolvedValue(access({ cashierScoped: true }));
      findOrderDetailMock.mockResolvedValue({
        header: header(),
        items: [item()],
        payments: [payment(extra)],
      });

      await expect(
        service.execute(authUser, 'branch-1', BILL),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('propagates a forbidden role without reading any data', async () => {
    resolveAccessMock.mockRejectedValue(new ForbiddenException());

    await expect(
      service.execute(authUser, 'branch-1', BILL),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findOrderDetailMock).not.toHaveBeenCalled();
  });

  it('asks for every refund to a full access role and only the own ones for a CASHIER', async () => {
    await service.execute(authUser, 'branch-1', BILL);
    expect(findOrderDetailMock).toHaveBeenLastCalledWith(
      'branch-1',
      BILL,
      null,
    );

    resolveAccessMock.mockResolvedValue(access({ cashierScoped: true }));
    await service.execute(authUser, 'branch-1', BILL);
    expect(findOrderDetailMock).toHaveBeenLastCalledWith('branch-1', BILL, ME);
  });
});
