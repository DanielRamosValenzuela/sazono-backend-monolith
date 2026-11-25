import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Role, StationTicketStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import {
  STATION_TICKET_INCLUDE,
  mapStationTicket,
} from './station-ticket-mapper';
import { loadTicketPrintStates } from './ticket-print-status';
import type {
  ListStationTicketsQueryDto,
  StationTicketResponseDto,
} from '../presentation/http/dto/kitchen.dto';

@Injectable()
export class ListStationTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    private readonly configService: ConfigService,
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

    const now = Date.now();
    const readyCutoff = new Date(
      now -
        this.configService.get<number>('KITCHEN_READY_VISIBLE_MINUTES', 10) *
          60_000,
    );
    const staleCutoff = new Date(
      now -
        this.configService.get<number>('KITCHEN_STALE_TICKET_HOURS', 12) *
          3_600_000,
    );

    const tickets = await this.prisma.stationTicket.findMany({
      where: {
        branchId: query.branchId,
        order: {
          status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] },
        },
        OR: [
          {
            status: StationTicketStatus.READY,
            completedAt: { gte: readyCutoff },
          },
          {
            status: { not: StationTicketStatus.READY },
            createdAt: { gte: staleCutoff },
          },
        ],
        ...(query.preparationStationId
          ? { preparationStationId: query.preparationStationId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }],
      include: STATION_TICKET_INCLUDE,
    });

    const states = await loadTicketPrintStates(this.prisma, tickets);

    return tickets.map((ticket) =>
      mapStationTicket(ticket, states.get(ticket.id)),
    );
  }
}
