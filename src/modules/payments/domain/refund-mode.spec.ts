import { PaymentMethod, PaymentStatus, RefundMethod } from '@prisma/client';
import { resolveRefundMode } from './refund-mode';

const TZ = 'America/Santiago';

const base = {
  status: PaymentStatus.PAID,
  provider: 'MANUAL',
  method: PaymentMethod.CASH as PaymentMethod | null,
  paidAt: new Date('2026-11-20T15:00:00Z') as Date | null,
  createdAt: new Date('2026-11-20T15:00:00Z'),
};

describe('resolveRefundMode', () => {
  const now = new Date('2026-11-20T18:00:00Z');

  it('lets a cashier refund cash collected today', () => {
    expect(
      resolveRefundMode({ payment: base, isAdmin: false, now, timeZone: TZ }),
    ).toEqual({ allowed: true, method: RefundMethod.CASH_MANUAL });
  });

  it('denies a cashier a cash payment from another day', () => {
    const result = resolveRefundMode({
      payment: { ...base, paidAt: new Date('2026-11-19T15:00:00Z') },
      isAdmin: false,
      now,
      timeZone: TZ,
    });

    expect(result).toMatchObject({
      allowed: false,
      code: 'REFUND_CASHIER_DAY_LIMIT',
    });
  });

  it('measures the day in the restaurant timezone, not UTC', () => {
    const paidAt = new Date('2026-11-21T02:30:00Z');

    expect(
      resolveRefundMode({
        payment: { ...base, paidAt },
        isAdmin: false,
        now: new Date('2026-11-21T02:50:00Z'),
        timeZone: TZ,
      }).allowed,
    ).toBe(true);

    expect(
      resolveRefundMode({
        payment: { ...base, paidAt },
        isAdmin: false,
        now: new Date('2026-11-21T03:30:00Z'),
        timeZone: TZ,
      }),
    ).toMatchObject({ allowed: false, code: 'REFUND_CASHIER_DAY_LIMIT' });
  });

  it('lets an admin refund old cash', () => {
    expect(
      resolveRefundMode({
        payment: { ...base, paidAt: new Date('2026-10-01T15:00:00Z') },
        isAdmin: true,
        now,
        timeZone: TZ,
      }),
    ).toEqual({ allowed: true, method: RefundMethod.CASH_MANUAL });
  });

  it.each([
    ['card', 'MANUAL', PaymentMethod.CREDIT_CARD],
    ['unclassified', 'MANUAL', null],
    ['mercado pago', 'MERCADO_PAGO', PaymentMethod.MERCADO_PAGO],
    ['transbank', 'TRANSBANK', PaymentMethod.CREDIT_CARD],
    ['cash method on a gateway provider', 'MERCADO_PAGO', PaymentMethod.CASH],
  ])('treats %s as manual external, admin only', (_label, provider, method) => {
    const payment = { ...base, provider, method };

    expect(
      resolveRefundMode({ payment, isAdmin: true, now, timeZone: TZ }),
    ).toEqual({ allowed: true, method: RefundMethod.MANUAL_EXTERNAL });
    expect(
      resolveRefundMode({ payment, isAdmin: false, now, timeZone: TZ }),
    ).toMatchObject({ allowed: false, code: 'REFUND_ADMIN_ONLY' });
  });

  it.each([
    PaymentStatus.PENDING,
    PaymentStatus.AUTHORIZED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.REFUNDED,
  ])('rejects a %s payment', (status) => {
    expect(
      resolveRefundMode({
        payment: { ...base, status },
        isAdmin: true,
        now,
        timeZone: TZ,
      }),
    ).toMatchObject({ allowed: false, code: 'REFUND_PAYMENT_NOT_PAID' });
  });

  it('falls back to createdAt when paidAt is missing', () => {
    expect(
      resolveRefundMode({
        payment: { ...base, paidAt: null },
        isAdmin: false,
        now,
        timeZone: TZ,
      }).allowed,
    ).toBe(true);
  });
});

describe('resolveRefundMode gateway', () => {
  const now = new Date('2026-11-20T18:00:00Z');
  const gatewayBase = {
    ...base,
    provider: 'MERCADO_PAGO',
    method: PaymentMethod.MERCADO_PAGO,
    providerReference: 'ORD1',
  };

  it('uses the gateway for a Mercado Pago payment with a reference, admin only', () => {
    expect(
      resolveRefundMode({
        payment: gatewayBase,
        isAdmin: true,
        now,
        timeZone: TZ,
      }),
    ).toEqual({ allowed: true, method: RefundMethod.GATEWAY });
    expect(
      resolveRefundMode({
        payment: gatewayBase,
        isAdmin: false,
        now,
        timeZone: TZ,
      }),
    ).toMatchObject({ allowed: false, code: 'REFUND_ADMIN_ONLY' });
  });

  it('needs buy order and child commerce code for Transbank', () => {
    const transbank = {
      ...gatewayBase,
      provider: 'TRANSBANK',
      method: PaymentMethod.CREDIT_CARD,
    };

    expect(
      resolveRefundMode({
        payment: transbank,
        isAdmin: true,
        now,
        timeZone: TZ,
      }),
    ).toEqual({ allowed: true, method: RefundMethod.MANUAL_EXTERNAL });
    expect(
      resolveRefundMode({
        payment: {
          ...transbank,
          gatewayMeta: { buy_order: 'sz-1', childCommerceCode: '5970' },
        },
        isAdmin: true,
        now,
        timeZone: TZ,
      }),
    ).toEqual({ allowed: true, method: RefundMethod.GATEWAY });
  });

  it('keeps manual external when the admin registers it as manual', () => {
    expect(
      resolveRefundMode({
        payment: gatewayBase,
        isAdmin: true,
        now,
        timeZone: TZ,
        registerAsManual: true,
      }),
    ).toEqual({ allowed: true, method: RefundMethod.MANUAL_EXTERNAL });
  });
});
