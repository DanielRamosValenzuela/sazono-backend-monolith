import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateLeadDto,
  LeadResponseDto,
} from '../presentation/http/dto/leads.dto';

@Injectable()
export class CreateLeadService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(dto: CreateLeadDto): Promise<LeadResponseDto> {
    const lead = await this.prisma.lead.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() || null,
        businessName: dto.businessName?.trim() || null,
        intent: dto.intent,
        message: dto.message?.trim() || null,
      },
    });

    return {
      leadId: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      businessName: lead.businessName,
      intent: lead.intent,
      message: lead.message,
      status: lead.status,
      createdAt: lead.createdAt.toISOString(),
    };
  }
}
