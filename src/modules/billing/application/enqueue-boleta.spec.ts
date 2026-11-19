import { BillStatus, type Prisma, TaxDocumentStatus } from '@prisma/client';
import { enqueueBoletaForPaidBill } from './enqueue-boleta';

type Options = {
  bill?: Record<string, unknown> | null;
  account?: unknown;
  items?: Record<string, unknown>[];
};

function build(options: Options = {}) {
  const row =
    options.bill === null
      ? null
      : {
          id: 'bill-1',
          number: 14,
          status: BillStatus.PAID,
          branchId: 'br-1',
          subtotalAmount: '11000',
          discountAmount: '1000',
          tipAmount: '1000',
          branchName: 'Local Centro',
          restaurantId: 'rest-1',
          timezone: 'America/Santiago',
          taxId: '76.795.561-8',
          legalName: 'Demo SpA',
          restaurantName: 'Demo',
          businessActivity: 'Restaurantes',
          legalAddress: 'Calle 1',
          legalCommune: 'Santiago',
          legalCity: 'Santiago',
          economicActivityCode: 561000,
          items: options.items ?? [
            {
              description: 'Plato',
              quantity: 2,
              unitPrice: '5500',
              totalPrice: '11000',
              discountAmount: '1000',
            },
          ],
          lastPayment: { id: 'pay-1', method: 'CASH' },
          ...options.bill,
        };

  return {
    $queryRaw: jest.fn().mockResolvedValue(row ? [row] : []),
    restaurantTaxProviderAccount: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.account === undefined
            ? { id: 'acc-1', environment: 'SANDBOX' }
            : options.account,
        ),
    },
    taxDocument: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const run = (tx: ReturnType<typeof build>) =>
  enqueueBoletaForPaidBill(tx as unknown as Prisma.TransactionClient, 'bill-1');

const createdData = (tx: ReturnType<typeof build>) =>
  (
    tx.taxDocument.createMany.mock.calls[0] as [
      { data: Record<string, unknown>[] },
    ]
  )[0].data[0];

describe('enqueueBoletaForPaidBill', () => {
  it('creates one PENDING boleta for the consumption net of discounts, without the tip', async () => {
    const tx = build();

    await run(tx);

    expect(tx.taxDocument.createMany).toHaveBeenCalledTimes(1);
    const data = createdData(tx);
    expect(data).toMatchObject({
      restaurantId: 'rest-1',
      branchId: 'br-1',
      billId: 'bill-1',
      paymentId: 'pay-1',
      type: 'BOLETA_AFECTA',
      status: TaxDocumentStatus.PENDING,
      provider: 'openfactura',
      idempotencyKey: 'boleta:bill-1',
    });
    expect((data.totalAmount as Prisma.Decimal).toString()).toBe('10000');
    expect((data.netAmount as Prisma.Decimal).toString()).toBe('8403');
    expect((data.vatAmount as Prisma.Decimal).toString()).toBe('1597');
    expect((data.tipAmount as Prisma.Decimal).toString()).toBe('1000');
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
    expect(data.requestSnapshot).toMatchObject({
      kind: 'BOLETA',
      billNumber: 14,
      paymentMethod: 'CASH',
      discountTotal: 1000,
      tip: 1000,
      totals: { gross: 10000, net: 8403, vat: 1597, exempt: 0 },
      lines: [
        {
          name: 'Plato',
          quantity: 2,
          unitPrice: 5500,
          discount: 1000,
          total: 10000,
        },
      ],
    });
  });

  it('does nothing when the restaurant has no active provider account', async () => {
    const tx = build({ account: null });

    await run(tx);

    expect(tx.taxDocument.createMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.restaurantTaxProviderAccount.findFirst).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the bill is not PAID', async () => {
    const tx = build({ bill: { status: BillStatus.PARTIALLY_PAID } });

    await run(tx);

    expect(tx.taxDocument.createMany).not.toHaveBeenCalled();
  });

  it('is idempotent per bill through an insert that skips duplicates', async () => {
    const tx = build();

    await run(tx);

    expect(tx.taxDocument.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(createdData(tx).idempotencyKey).toBe('boleta:bill-1');
  });

  it('uses 3 queries when the provider is active and 1 when it is not', async () => {
    const active = build();
    await run(active);
    expect(
      active.restaurantTaxProviderAccount.findFirst.mock.calls.length +
        active.$queryRaw.mock.calls.length +
        active.taxDocument.createMany.mock.calls.length,
    ).toBe(3);

    const none = build({ account: null });
    await run(none);
    expect(
      none.restaurantTaxProviderAccount.findFirst.mock.calls.length +
        none.$queryRaw.mock.calls.length +
        none.taxDocument.createMany.mock.calls.length,
    ).toBe(1);
  });

  it('skips bills with no consumption left after discounts', async () => {
    const tx = build({
      bill: { discountAmount: '11000', tipAmount: '0' },
    });

    await run(tx);

    expect(tx.taxDocument.createMany).not.toHaveBeenCalled();
  });

  it('still enqueues with a single consumption line when the items do not add up', async () => {
    const tx = build({
      items: [
        {
          description: 'Plato',
          quantity: 1,
          unitPrice: '5000',
          totalPrice: '5000',
          discountAmount: '0',
        },
      ],
    });

    await run(tx);

    expect(createdData(tx).requestSnapshot).toMatchObject({
      lines: [{ name: 'Consumo restaurante', total: 10000 }],
    });
  });

  it('never blocks the payment when the snapshot cannot be built', async () => {
    const tx = build({
      bill: { subtotalAmount: '0.4', discountAmount: '0', tipAmount: '0' },
    });

    await expect(run(tx)).resolves.toBeUndefined();
    expect(tx.taxDocument.createMany).not.toHaveBeenCalled();
  });

  it('stores the issue date in the restaurant timezone', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-20T02:30:00.000Z') });
    const tx = build();

    await run(tx);
    jest.useRealTimers();

    expect(createdData(tx).requestSnapshot).toMatchObject({
      issueDate: '2026-11-19',
    });
  });
});
