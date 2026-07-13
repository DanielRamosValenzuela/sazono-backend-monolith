import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { LeadResponseDto } from '../presentation/http/dto/leads.dto';

@Injectable()
export class ListLeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<LeadResponseDto[]> {
    const leads = await this.prisma.lead.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });

    return leads.map((lead) => ({
      leadId: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      businessName: lead.businessName,
      intent: lead.intent,
      message: lead.message,
      status: lead.status,
      createdAt: lead.createdAt.toISOString(),
    }));
  }
}
