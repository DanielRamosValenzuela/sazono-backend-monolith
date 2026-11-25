import type { Prisma, Printer, PrismaClient } from '@prisma/client';
import { PrintJobKind } from '@prisma/client';
import {
  DEFAULT_BUSINESS_DAY_START_HOUR,
  DEFAULT_TIMEZONE,
  businessDateKey,
  formatDisplayNumber,
} from '../domain/business-day';
import {
  buildReceiptDocument,
  type StationTicketSnapshot,
} from '../domain/receipt-builder';
import { formatModifierLines } from '../../orders/domain/modifier-lines';
import { runIsolated } from './isolated';

const TICKET_INCLUDE = {
  preparationStation: true,
  branch: {
    include: {
      restaurant: { select: { timezone: true } },
      settings: { select: { businessDayStartHour: true } },
    },
  },
  order: {
    include: {
      createdByStaffUser: { select: { firstName: true, lastName: true } },
      tableSession: { include: { table: true } },
    },
  },
  stationTicketItems: {
    orderBy: [{ createdAt: 'asc' as const }],
    include: {
      orderItem: {
        include: {
          modifiers: {
            orderBy: [
              { depth: 'asc' as const },
              { createdAt: 'asc' as const },
              { id: 'asc' as const },
            ],
          },
        },
      },
    },
  },
} satisfies Prisma.StationTicketInclude;

export type LoadedStationTicket = Prisma.StationTicketGetPayload<{
  include: typeof TICKET_INCLUDE;
}>;

export function loadStationTickets(
  tx: Prisma.TransactionClient,
  stationTicketIds: string[],
): Promise<LoadedStationTicket[]> {
  return tx.stationTicket.findMany({
    where: { id: { in: stationTicketIds } },
    include: TICKET_INCLUDE,
  });
}

export function ticketTimezone(ticket: LoadedStationTicket): string {
  return ticket.branch.restaurant.timezone || DEFAULT_TIMEZONE;
}

export function buildTicketSnapshot(
  ticket: LoadedStationTicket,
  displayNumber: string,
): StationTicketSnapshot {
  const session = ticket.order.tableSession;

  return {
    stationName: ticket.preparationStation.name,
    displayNumber,
    sentAt: ticket.sentAt ?? ticket.createdAt,
    timezone: ticketTimezone(ticket),
    isCounter: session.isCounter,
    ticketNumber: session.ticketNumber,
    tableCode: session.table.code,
    customerLabel: session.customerLabel,
    orderNotes: ticket.order.notes,
    isQrOrder: ticket.order.source === 'QR',
    staff: ticket.order.createdByStaffUser,
    items: ticket.stationTicketItems.map((item) => ({
      quantity: item.quantity,
      name: item.orderItem.nameSnapshot,
      notes: item.orderItem.notes,
      options: formatModifierLines(item.orderItem.modifiers),
    })),
  };
}

type CounterClient = Pick<PrismaClient, '$queryRaw'>;

let counterClient: CounterClient | null = null;

export function bindTicketCounterClient(client: CounterClient | null): void {
  counterClient = client;
}

export async function allocateTicketSeq(
  fallback: Prisma.TransactionClient,
  preparationStationId: string,
  businessDate: string,
): Promise<number> {
  const client = counterClient ?? fallback;
  const rows = await client.$queryRaw<{ last_seq: number }[]>`
    INSERT INTO print_ticket_counters (preparation_station_id, business_date, last_seq)
    VALUES (${preparationStationId}::uuid, ${businessDate}::date, 1)
    ON CONFLICT (preparation_station_id, business_date)
    DO UPDATE SET last_seq = print_ticket_counters.last_seq + 1
    RETURNING last_seq
  `;

  return Number(rows[0].last_seq);
}

export async function assignPrintCode(
  tx: Prisma.TransactionClient,
  station: { id: string; branchId: string },
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${station.branchId}))`;

  const used = await tx.preparationStation.findMany({
    where: { branchId: station.branchId, printCode: { not: null } },
    select: { id: true, printCode: true },
  });
  const own = used.find((row) => row.id === station.id);

  if (own?.printCode) {
    return own.printCode;
  }

  const highest = used.reduce((max, row) => {
    const numeric = Number(row.printCode);

    return Number.isInteger(numeric) && numeric > max ? numeric : max;
  }, 0);
  const printCode = String(highest + 1).padStart(2, '0');

  await tx.preparationStation.update({
    where: { id: station.id },
    data: { printCode },
  });

  return printCode;
}

export function jobIdempotencyKey(
  stationTicketId: string,
  printerId: string,
  suffix: string,
): string {
  return `ST:${stationTicketId}:P:${printerId}:${suffix}`;
}

export async function enqueueStationTicketPrintsUnsafe(
  tx: Prisma.TransactionClient,
  stationTicketIds: string[],
): Promise<void> {
  if (stationTicketIds.length === 0) {
    return;
  }

  const tickets = await loadStationTickets(tx, stationTicketIds);

  if (tickets.length === 0) {
    return;
  }

  const links = await tx.printerStation.findMany({
    where: {
      preparationStationId: {
        in: [...new Set(tickets.map((t) => t.preparationStationId))],
      },
      printer: { active: true },
    },
    include: { printer: true },
  });
  const printersByStation = new Map<string, Printer[]>();

  for (const link of links) {
    const list = printersByStation.get(link.preparationStationId) ?? [];

    list.push(link.printer);
    printersByStation.set(link.preparationStationId, list);
  }

  const codes = new Map<string, string | null>();

  for (const { preparationStation: station } of tickets) {
    if (codes.has(station.id)) {
      continue;
    }

    codes.set(
      station.id,
      station.printCode ??
        (printersByStation.has(station.id)
          ? await assignPrintCode(tx, station)
          : null),
    );
  }

  const numbers = await Promise.all(
    tickets.map(async (ticket) => {
      const printCode = codes.get(ticket.preparationStationId);

      if (ticket.displayNumber || !printCode) {
        return { ticket, displayNumber: ticket.displayNumber, dateKey: null };
      }

      const startHour =
        ticket.branch.settings?.businessDayStartHour ??
        DEFAULT_BUSINESS_DAY_START_HOUR;
      const dateKey = businessDateKey(
        ticket.sentAt ?? ticket.createdAt,
        ticketTimezone(ticket),
        startHour,
      );
      const seq = await allocateTicketSeq(
        tx,
        ticket.preparationStationId,
        dateKey,
      );

      return {
        ticket,
        displayNumber: formatDisplayNumber(printCode, seq),
        dateKey,
      };
    }),
  );
  const jobs: Prisma.PrintJobCreateManyInput[] = [];

  for (const { ticket, displayNumber, dateKey } of numbers) {
    if (dateKey && displayNumber) {
      await tx.stationTicket.update({
        where: { id: ticket.id },
        data: {
          displayNumber,
          businessDate: new Date(`${dateKey}T00:00:00.000Z`),
        },
      });
    }

    const printers = printersByStation.get(ticket.preparationStationId) ?? [];

    if (printers.length === 0 || !displayNumber) {
      continue;
    }

    const snapshot = buildTicketSnapshot(ticket, displayNumber);

    for (const printer of printers) {
      jobs.push({
        branchId: ticket.branchId,
        printerId: printer.id,
        stationTicketId: ticket.id,
        kind: PrintJobKind.COMANDA,
        idempotencyKey: jobIdempotencyKey(ticket.id, printer.id, 'R0'),
        document: buildReceiptDocument(snapshot, {
          copies: printer.copies,
        }),
      });
    }
  }

  if (jobs.length > 0) {
    await tx.printJob.createMany({ data: jobs, skipDuplicates: true });
  }
}

export function enqueueStationTicketPrintUnsafe(
  tx: Prisma.TransactionClient,
  stationTicketId: string,
): Promise<void> {
  return enqueueStationTicketPrintsUnsafe(tx, [stationTicketId]);
}

export async function enqueueStationTicketPrints(
  tx: Prisma.TransactionClient,
  stationTicketIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = stationTicketIds.filter((id): id is string => Boolean(id));

  if (ids.length === 0) {
    return;
  }

  await runIsolated(tx, 'Encolar comanda', () =>
    enqueueStationTicketPrintsUnsafe(tx, ids),
  );
}
