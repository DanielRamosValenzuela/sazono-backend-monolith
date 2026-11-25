import { Logger } from '@nestjs/common';
import {
  PrintJobKind,
  PrintJobStatus,
  PrinterStatus,
  type PrismaClient,
} from '@prisma/client';
import type {
  StationTicketPrintDto,
  StationTicketPrintStatus,
} from '../presentation/http/dto/kitchen.dto';

const logger = new Logger('KitchenPrintStatus');

export const NO_PRINT: StationTicketPrintDto = {
  status: 'NONE',
  lastJobId: null,
  printerOffline: false,
};

const STATUS_BY_JOB: Partial<Record<PrintJobStatus, StationTicketPrintStatus>> =
  {
    [PrintJobStatus.PENDING]: 'PENDING',
    [PrintJobStatus.CLAIMED]: 'PENDING',
    [PrintJobStatus.PRINTED]: 'PRINTED',
    [PrintJobStatus.FAILED]: 'FAILED',
  };

const PRIORITY: StationTicketPrintStatus[] = ['FAILED', 'PENDING', 'PRINTED'];

function mapStatus(status: PrintJobStatus): StationTicketPrintStatus {
  return STATUS_BY_JOB[status] ?? 'NONE';
}

function aggregate(
  statuses: StationTicketPrintStatus[],
): StationTicketPrintStatus {
  return PRIORITY.find((p) => statuses.includes(p)) ?? 'NONE';
}

type PrintStatusClient = Pick<PrismaClient, 'printJob' | 'printerStation'>;

export async function loadTicketPrintStates(
  prisma: PrintStatusClient,
  tickets: Array<{ id: string; preparationStationId: string }>,
): Promise<Map<string, StationTicketPrintDto>> {
  const states = new Map<string, StationTicketPrintDto>();

  if (tickets.length === 0) {
    return states;
  }

  try {
    const [jobs, offline] = await Promise.all([
      prisma.printJob.findMany({
        where: {
          stationTicketId: { in: tickets.map((t) => t.id) },
          kind: PrintJobKind.COMANDA,
          status: { not: PrintJobStatus.CANCELLED },
        },
        select: {
          id: true,
          stationTicketId: true,
          printerId: true,
          status: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['stationTicketId', 'printerId'],
      }),
      prisma.printerStation.findMany({
        where: {
          preparationStationId: {
            in: [...new Set(tickets.map((t) => t.preparationStationId))],
          },
          printer: { active: true, status: PrinterStatus.OFFLINE },
        },
        select: { preparationStationId: true },
      }),
    ]);
    const offlineStations = new Set(offline.map((o) => o.preparationStationId));
    const byTicket = new Map<string, typeof jobs>();

    for (const job of jobs) {
      const list = byTicket.get(job.stationTicketId as string) ?? [];

      list.push(job);
      byTicket.set(job.stationTicketId as string, list);
    }

    for (const ticket of tickets) {
      const list = byTicket.get(ticket.id) ?? [];
      const status = aggregate(list.map((j) => mapStatus(j.status)));
      const job = list.find((j) => mapStatus(j.status) === status);

      states.set(ticket.id, {
        status,
        lastJobId: job?.id ?? null,
        printerOffline: offlineStations.has(ticket.preparationStationId),
      });
    }
  } catch (error) {
    logger.warn(
      `No se pudo cargar el estado de impresion: ${
        error instanceof Error ? error.message : 'error desconocido'
      }`,
    );
  }

  return states;
}
