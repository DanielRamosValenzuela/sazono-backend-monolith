import { LeadIntent, LeadStatus } from '@prisma/client';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateLeadService } from './create-lead.service';

describe('CreateLeadService', () => {
  const leadCreateMock = jest.fn();
  const prisma = {
    lead: {
      create: leadCreateMock,
    },
  } as unknown as PrismaService;

  let service: CreateLeadService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreateLeadService(prisma);
  });

  it('normalizes email and trims optional fields before persisting', async () => {
    leadCreateMock.mockResolvedValue({
      id: 'lead-1',
      name: 'Ana Diaz',
      email: 'ana@resto.cl',
      phone: '+56911112222',
      businessName: 'Mi Restaurante',
      intent: LeadIntent.DEMO_REQUEST,
      message: 'Quiero una demo',
      status: LeadStatus.NEW,
      createdAt: new Date('2026-07-13T12:00:00.000Z'),
    });

    const result = await service.execute({
      name: '  Ana Diaz  ',
      email: '  Ana@Resto.cl  ',
      phone: '  +56911112222  ',
      businessName: '  Mi Restaurante  ',
      intent: LeadIntent.DEMO_REQUEST,
      message: '  Quiero una demo  ',
    });

    expect(leadCreateMock).toHaveBeenCalledWith({
      data: {
        name: 'Ana Diaz',
        email: 'ana@resto.cl',
        phone: '+56911112222',
        businessName: 'Mi Restaurante',
        intent: LeadIntent.DEMO_REQUEST,
        message: 'Quiero una demo',
      },
    });
    expect(result.leadId).toBe('lead-1');
    expect(result.status).toBe(LeadStatus.NEW);
  });

  it('stores optional fields as null when omitted', async () => {
    leadCreateMock.mockResolvedValue({
      id: 'lead-2',
      name: 'Beto Soto',
      email: 'beto@resto.cl',
      phone: null,
      businessName: null,
      intent: LeadIntent.GENERAL_INQUIRY,
      message: null,
      status: LeadStatus.NEW,
      createdAt: new Date('2026-07-13T12:00:00.000Z'),
    });

    await service.execute({
      name: 'Beto Soto',
      email: 'beto@resto.cl',
      intent: LeadIntent.GENERAL_INQUIRY,
    });

    expect(leadCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: null,
        businessName: null,
        message: null,
      }),
    });
  });
});
