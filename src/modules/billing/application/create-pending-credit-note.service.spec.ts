import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { buildBoletaSnapshot } from '../../tax-documents/domain/tax-snapshot';
import {
  CreatePendingCreditNoteService,
  enqueueCreditNoteForRefund,
} from './create-pending-credit-note.service';

const refund = {
  id: 'rf1',
  restaurantId: 'r1',
  branchId: 'b1',
  billId: 'bill1',
  paymentId: 'p1',
  amount: new Prisma.Decimal(6545),
  tipAmount: new Prisma.Decimal(595),
  netAmount: new Prisma.Decimal(5000),
  vatAmount: new Prisma.Decimal(950),
  reasonText: 'Plato frio',
};

function build(overrides: {
  existing?: unknown;
  refund?: unknown;
  boleta?: unknown;
}) {
  const client = {
    taxDocument: {
      findUnique: jest.fn().mockResolvedValue(overrides.existing ?? null),
      findFirst: jest.fn().mockResolvedValue(overrides.boleta ?? null),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown }) =>
          Promise.resolve(data),
        ),
    },
    refund: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.refund === undefined ? refund : overrides.refund,
        ),
    },
  };

  return {
    client,
    service: new CreatePendingCreditNoteService(
      client as unknown as PrismaService,
    ),
  };
}

describe('CreatePendingCreditNoteService', () => {
  it('creates a pending credit note with the credit note basis amounts', async () => {
    const { service, client } = build({});

    await service.execute('rf1');

    const data = client.taxDocument.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: 'NOTA_CREDITO',
      status: 'PENDING',
      refundId: 'rf1',
      referenceDocumentId: null,
      referenceCode: null,
      reason: 'Plato frio',
    });
    expect(data.totalAmount.toString()).toBe('6545');
    expect(data.tipAmount.toString()).toBe('595');
  });

  it('references the issued boleta of the bill when there is one', async () => {
    const { service, client } = build({ boleta: { id: 'td-boleta' } });

    await service.execute('rf1');

    expect(client.taxDocument.create.mock.calls[0][0].data).toMatchObject({
      referenceDocumentId: 'td-boleta',
      referenceCode: 3,
    });
  });

  it('is idempotent per refund', async () => {
    const { service, client } = build({ existing: { id: 'td1' } });

    await expect(service.execute('rf1')).resolves.toEqual({ id: 'td1' });
    expect(client.taxDocument.create).not.toHaveBeenCalled();
  });

  it('fails when the refund does not exist', async () => {
    const { service } = build({ refund: null });

    await expect(service.execute('missing')).rejects.toThrow('no existe');
  });
});

describe('enqueueCreditNoteForRefund', () => {
  const boletaSnapshot = buildBoletaSnapshot({
    idempotencyKey: 'boleta:bill1',
    issueDate: '2026-11-19',
    billId: 'bill1',
    billNumber: 3,
    branch: { id: 'b1', name: 'Local' },
    emitter: {
      rut: '76795561-8',
      legalName: 'Demo SpA',
      activity: 'Restaurantes',
      economicActivityCode: 561000,
      address: 'Calle 1',
      commune: 'Santiago',
      city: null,
    },
    paymentMethod: null,
    items: [],
    consumption: 10000,
    net: 8403,
    vat: 1597,
    tip: 0,
  });
  const consumptionRefund = {
    ...refund,
    amount: new Prisma.Decimal(5000),
    tipAmount: new Prisma.Decimal(0),
    netAmount: new Prisma.Decimal(4202),
    vatAmount: new Prisma.Decimal(798),
  };

  function buildTx(
    options: { refund?: unknown; account?: unknown; boleta?: unknown } = {},
  ) {
    return {
      refund: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options.refund === undefined ? consumptionRefund : options.refund,
          ),
      },
      restaurantTaxProviderAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options.account === undefined
              ? { id: 'acc-1', environment: 'SANDBOX' }
              : options.account,
          ),
      },
      $queryRaw: jest.fn().mockResolvedValue(
        options.boleta === null
          ? []
          : [
              options.boleta ?? {
                id: 'td-boleta',
                totalAmount: '10000',
                requestSnapshot: boletaSnapshot,
                timezone: 'America/Santiago',
              },
            ],
      ),
      taxDocument: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }

  const run = (tx: ReturnType<typeof buildTx>) =>
    enqueueCreditNoteForRefund(
      tx as unknown as Prisma.TransactionClient,
      'rf1',
    );

  const created = (tx: ReturnType<typeof buildTx>) =>
    (
      tx.taxDocument.createMany.mock.calls[0] as [
        { data: Record<string, Prisma.Decimal>[] },
      ]
    )[0].data[0];

  const queries = (tx: ReturnType<typeof buildTx>) =>
    tx.refund.findUnique.mock.calls.length +
    tx.restaurantTaxProviderAccount.findFirst.mock.calls.length +
    tx.$queryRaw.mock.calls.length +
    tx.taxDocument.createMany.mock.calls.length;

  it('queues a partial credit note referencing the boleta for the refunded consumption', async () => {
    const tx = buildTx();

    await run(tx);

    const data = created(tx);
    expect(data).toMatchObject({
      type: 'NOTA_CREDITO',
      status: 'PENDING',
      refundId: 'rf1',
      referenceDocumentId: 'td-boleta',
      referenceCode: 3,
      provider: 'openfactura',
      idempotencyKey: 'credit-note:rf1',
      reason: 'Plato frio',
    });
    expect(data.totalAmount.toString()).toBe('5000');
    expect(data.netAmount.toString()).toBe('4202');
    expect(data.requestSnapshot).toMatchObject({
      kind: 'CREDIT_NOTE',
      boletaTaxDocumentId: 'td-boleta',
      totals: { gross: 5000, net: 4202, vat: 798 },
    });
  });

  it('uses reference code 1 when the whole boleta is credited', async () => {
    const tx = buildTx({
      refund: {
        ...consumptionRefund,
        amount: new Prisma.Decimal(10000),
        netAmount: new Prisma.Decimal(8403),
        vatAmount: new Prisma.Decimal(1597),
      },
    });

    await run(tx);

    expect(created(tx).referenceCode).toBe(1);
  });

  it('leaves the tip out of the credit note amounts', async () => {
    const tx = buildTx({
      refund: {
        ...consumptionRefund,
        amount: new Prisma.Decimal(5500),
        tipAmount: new Prisma.Decimal(500),
      },
    });

    await run(tx);

    const data = created(tx);
    expect(data.totalAmount.toString()).toBe('5000');
    expect(data.tipAmount.toString()).toBe('500');
  });

  it('does nothing for a tip only refund', async () => {
    const tx = buildTx({
      refund: {
        ...consumptionRefund,
        amount: new Prisma.Decimal(500),
        tipAmount: new Prisma.Decimal(500),
        netAmount: new Prisma.Decimal(0),
        vatAmount: new Prisma.Decimal(0),
      },
    });

    await expect(run(tx)).resolves.toBeUndefined();
    expect(tx.taxDocument.createMany).not.toHaveBeenCalled();
  });

  it('does nothing when the restaurant has no active provider', async () => {
    const tx = buildTx({ account: null });

    await expect(run(tx)).resolves.toBeUndefined();
    expect(tx.taxDocument.createMany).not.toHaveBeenCalled();
  });

  it('does a single query when there is no active account and the refund is known', async () => {
    const tx = buildTx({ account: null });

    await enqueueCreditNoteForRefund(
      tx as unknown as Prisma.TransactionClient,
      'rf1',
      consumptionRefund,
    );

    expect(queries(tx)).toBe(1);
    expect(tx.restaurantTaxProviderAccount.findFirst).toHaveBeenCalledTimes(1);
  });

  it('uses 3 queries with the refund known and an active provider', async () => {
    const tx = buildTx();

    await enqueueCreditNoteForRefund(
      tx as unknown as Prisma.TransactionClient,
      'rf1',
      consumptionRefund,
    );

    expect(tx.refund.findUnique).not.toHaveBeenCalled();
    expect(queries(tx)).toBe(3);
  });

  it('queues the credit note even while the boleta is still pending', async () => {
    const tx = buildTx();

    await run(tx);

    const [sql] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join('?')).toContain("t.status IN ('PENDING', 'ISSUED')");
  });

  it('does nothing when the bill has no boleta to reference', async () => {
    const tx = buildTx({ boleta: null });

    await expect(run(tx)).resolves.toBeUndefined();
    expect(tx.taxDocument.createMany).not.toHaveBeenCalled();
  });

  it('is idempotent per refund through an insert that skips duplicates', async () => {
    const tx = buildTx();

    await run(tx);

    expect(tx.taxDocument.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('never throws when the credit note amounts are inconsistent', async () => {
    const tx = buildTx({
      refund: { ...consumptionRefund, netAmount: new Prisma.Decimal(1) },
    });

    await expect(run(tx)).resolves.toBeUndefined();
    expect(tx.taxDocument.createMany).not.toHaveBeenCalled();
  });
});
