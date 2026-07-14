import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import {
  STATION_TICKET_INCLUDE,
  mapStationTicket,
} from './station-ticket-mapper';
import type {
  ListStationTicketsQueryDto,
  StationTicketResponseDto,
} from '../presentation/http/dto/kitchen.dto';

@Injectable()
export class ListStationTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(
    authUser: JwtPayload,
    query: ListStationTicketsQueryDto,
  ): Promise<StationTicketResponseDto[]> {
    await this.branchAccessService.ensureAccess(authUser, query.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
      Role.KITCHEN,
      Role.BAR,
    ]);

    const tickets = await this.prisma.stationTicket.findMany({
      where: {
        branchId: query.branchId,
        ...(query.preparationStationId
          ? { preparationStationId: query.preparationStationId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }],
      include: STATION_TICKET_INCLUDE,
    });

    return tickets.map(mapStationTicket);
  }
}
