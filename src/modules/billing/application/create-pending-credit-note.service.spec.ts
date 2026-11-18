import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CreatePendingCreditNoteService } from './create-pending-credit-note.service';

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
