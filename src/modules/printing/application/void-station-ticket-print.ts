import type { Prisma } from '@prisma/client';
import {
  PrintJobKind,
  PrintJobStatus,
  StationTicketStatus,
} from '@prisma/client';
import { DEFAULT_TIMEZONE } from '../domain/business-day';
import { buildVoidDocument } from '../domain/receipt-builder';
import {
  isReceiptDocument,
  type ReceiptDocument,
} from '../domain/receipt-document';
import { jobIdempotencyKey } from './enqueue-station-ticket-print';
import { runIsolated } from './isolated';

export type VoidTarget = { stationTicketId: string } | { orderId: string };

export type VoidInput = {
  reason: string | null;
  actorStaffUserId: string | null;
};

async function voidUnsafe(
  tx: Prisma.TransactionClient,
  target: VoidTarget,
  input: VoidInput,
): Promise<void> {
  const tickets = await tx.stationTicket.findMany({
    where:
      'stationTicketId' in target
        ? { id: target.stationTicketId }
        : {
            orderId: target.orderId,
            status: { not: StationTicketStatus.CANCELLED },
          },
    select: { id: true, branchId: true },
  });

  if (tickets.length === 0) {
    return;
  }

  const jobs = await tx.printJob.findMany({
    where: {
      stationTicketId: { in: tickets.map((t) => t.id) },
      kind: PrintJobKind.COMANDA,
      reprintOfId: null,
    },
    include: {
      printer: true,
      branch: { select: { restaurant: { select: { timezone: true } } } },
    },
  });

  if (jobs.length === 0) {
    return;
  }

  const droppable = jobs
    .filter(
      (job) =>
        job.status === PrintJobStatus.PENDING ||
        job.status === PrintJobStatus.FAILED,
    )
    .map((job) => job.id);

  if (droppable.length > 0) {
    await tx.printJob.updateMany({
      where: {
        id: { in: droppable },
        status: { in: [PrintJobStatus.PENDING, PrintJobStatus.FAILED] },
      },
      data: {
        status: PrintJobStatus.CANCELLED,
        leaseUntil: null,
        lastError: 'TICKET_CANCELLED',
      },
    });
  }

  const slipJobs = jobs.filter(
    (job) =>
      (job.status === PrintJobStatus.PRINTED ||
        job.status === PrintJobStatus.CLAIMED) &&
      job.printer.printVoidSlips &&
      job.printer.active &&
      job.stationTicketId &&
      isReceiptDocument(job.document),
  );

  if (slipJobs.length === 0) {
    return;
  }

  const staff = input.actorStaffUserId
    ? await tx.staffUser.findUnique({
        where: { id: input.actorStaffUserId },
        select: { firstName: true, lastName: true },
      })
    : null;
  const byLabel = staff ? `${staff.lastName}, ${staff.firstName}` : null;
  const now = new Date();

  await tx.printJob.createMany({
    data: slipJobs.map((job) => ({
      branchId: job.branchId,
      printerId: job.printerId,
      stationTicketId: job.stationTicketId,
      kind: PrintJobKind.VOID,
      idempotencyKey: jobIdempotencyKey(
        job.stationTicketId as string,
        job.printerId,
        'VOID',
      ),
      document: buildVoidDocument(job.document as unknown as ReceiptDocument, {
        now,
        timezone: job.branch.restaurant.timezone || DEFAULT_TIMEZONE,
        reason: input.reason,
        byLabel,
      }),
    })),
    skipDuplicates: true,
  });
}

export async function voidStationTicketPrint(
  tx: Prisma.TransactionClient,
  target: VoidTarget,
  input: VoidInput,
): Promise<void> {
  await runIsolated(tx, 'Anular comanda impresa', () =>
    voidUnsafe(tx, target, input),
  );
}
