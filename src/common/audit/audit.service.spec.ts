import type { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const globalCreate = jest.fn();
  const prisma = {
    auditLog: { create: globalCreate },
  } as unknown as PrismaService;
  const service = new AuditService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes every field with the client it receives', async () => {
    const txCreate = jest.fn().mockResolvedValue({});

    await service.record({ auditLog: { create: txCreate } } as never, {
      restaurantId: 'r1',
      branchId: 'b1',
      actorStaffUserId: 's1',
      actorRole: 'CASHIER',
      action: 'REFUND_SUCCEEDED',
      entityType: 'Refund',
      entityId: 'ref-1',
      before: { a: 1 },
      after: { b: 2 },
      reason: 'Plato frio',
      ip: '10.0.0.1',
      userAgent: 'jest',
    });

    expect(globalCreate).not.toHaveBeenCalled();
    expect(txCreate).toHaveBeenCalledWith({
      data: {
        restaurantId: 'r1',
        branchId: 'b1',
        actorStaffUserId: 's1',
        actorPlatformAdminId: null,
        actorRole: 'CASHIER',
        action: 'REFUND_SUCCEEDED',
        entityType: 'Refund',
        entityId: 'ref-1',
        before: { a: 1 },
        after: { b: 2 },
        reason: 'Plato frio',
        ip: '10.0.0.1',
        userAgent: 'jest',
      },
    });
  });

  it('uses the shared client when none is given and truncates ip and user agent', async () => {
    globalCreate.mockResolvedValue({});

    await service.record(null, {
      restaurantId: null,
      branchId: null,
      actorStaffUserId: null,
      actorRole: null,
      action: 'X',
      entityType: 'Payment',
      entityId: 'p1',
      ip: 'x'.repeat(500),
      userAgent: 'y'.repeat(500),
    });

    const data = (
      globalCreate.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;
    expect(data.ip).toHaveLength(200);
    expect(data.userAgent).toHaveLength(300);
    expect(data.reason).toBeNull();
  });
});
