import { LeadIntent, LeadStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { ListLeadsService } from './list-leads.service';

describe('ListLeadsService', () => {
  const leadFindManyMock = jest.fn();
  const prisma = {
    lead: {
      findMany: leadFindManyMock,
    },
  } as unknown as PrismaService;

  let service: ListLeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ListLeadsService(prisma);
  });

  it('lists leads ordered by most recent first', async () => {
    leadFindManyMock.mockResolvedValue([
      {
        id: 'lead-1',
        name: 'Ana Diaz',
        email: 'ana@resto.cl',
        phone: null,
        businessName: 'Mi Restaurante',
        intent: LeadIntent.DEMO_REQUEST,
        message: null,
        status: LeadStatus.NEW,
        createdAt: new Date('2026-07-13T12:00:00.000Z'),
      },
    ]);

    const result = await service.execute();

    expect(leadFindManyMock).toHaveBeenCalledWith({
      orderBy: [{ createdAt: 'desc' }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].leadId).toBe('lead-1');
  });
});
