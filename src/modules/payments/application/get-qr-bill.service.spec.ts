import { NotFoundException } from '@nestjs/common';
import { BillStatus, Prisma, TableStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { GetQrBillService } from './get-qr-bill.service';

describe('GetQrBillService', () => {
  const tableFindUniqueMock = jest.fn();
  const tableSessionFindFirstMock = jest.fn();
  const prisma = {
    table: {
      findUnique: tableFindUniqueMock,
    },
    tableSession: {
      findFirst: tableSessionFindFirstMock,
    },
  } as unknown as PrismaService;

  let service: GetQrBillService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GetQrBillService(prisma);
  });

  it('returns the bill summary for the active session', async () => {
    tableFindUniqueMock.mockResolvedValue({
      id: 'table-1',
      status: TableStatus.OCCUPIED,
    });
    tableSessionFindFirstMock.mockResolvedValue({
      id: 'session-1',
      bill: {
        id: 'bill-1',
        status: BillStatus.PARTIALLY_PAID,
        subtotalAmount: new Prisma.Decimal(10000),
        tipAmount: new Prisma.Decimal(1000),
        totalAmount: new Prisma.Decimal(11000),
        remainingAmount: new Prisma.Decimal(5000),
      },
    });

    const result = await service.execute('qr-token-1');

    expect(result).toEqual({
      billId: 'bill-1',
      status: BillStatus.PARTIALLY_PAID,
      subtotalAmount: '10000',
      tipAmount: '1000',
      totalAmount: '11000',
      remainingAmount: '5000',
    });
  });

  it('returns null when the table has no active session', async () => {
    tableFindUniqueMock.mockResolvedValue({
      id: 'table-1',
      status: TableStatus.AVAILABLE,
    });
    tableSessionFindFirstMock.mockResolvedValue(null);

    const result = await service.execute('qr-token-1');

    expect(result).toBeNull();
  });

  it('returns null when the active session has no bill yet', async () => {
    tableFindUniqueMock.mockResolvedValue({
      id: 'table-1',
      status: TableStatus.OCCUPIED,
    });
    tableSessionFindFirstMock.mockResolvedValue({
      id: 'session-1',
      bill: null,
    });

    const result = await service.execute('qr-token-1');

    expect(result).toBeNull();
  });

  it('throws NotFoundException when the qr token does not resolve to a table', async () => {
    tableFindUniqueMock.mockResolvedValue(null);

    await expect(service.execute('bad-token')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the table is disabled', async () => {
    tableFindUniqueMock.mockResolvedValue({
      id: 'table-1',
      status: TableStatus.DISABLED,
    });

    await expect(service.execute('qr-token-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
