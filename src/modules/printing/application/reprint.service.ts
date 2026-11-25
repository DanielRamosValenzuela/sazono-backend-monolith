import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrintJobKind, type PrintJob, type Role } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DEFAULT_TIMEZONE } from '../domain/business-day';
import { buildReprintDocument } from '../domain/receipt-builder';
import { isReceiptDocument } from '../domain/receipt-document';
import { jobIdempotencyKey } from './enqueue-station-ticket-print';

export type ReprintActor = {
  restaurantId: string;
  branchId: string;
  staffUserId: string | null;
  role: Role | null;
};

const REPRINT_KEY = /:R(\d+)$/;

@Injectable()
export class ReprintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async reprintJob(jobId: string, actor: ReprintActor): Promise<PrintJob> {
    const original = await this.prisma.printJob.findFirst({
      where: { id: jobId, branchId: actor.branchId },
      include: {
        branch: { select: { restaurant: { select: { timezone: true } } } },
      },
    });

    if (!original) {
      throw new NotFoundException('La comanda indicada no existe.');
    }

    if (original.kind !== PrintJobKind.COMANDA) {
      throw new ConflictException(
        original.kind === PrintJobKind.VOID
          ? 'Las hojas de anulacion no se reimprimen.'
          : 'Solo se reimprimen comandas.',
      );
    }

    if (!original.stationTicketId) {
      throw new NotFoundException('La comanda indicada no existe.');
    }

    if (!isReceiptDocument(original.document)) {
      throw new BadRequestException('La comanda no tiene un documento valido.');
    }

    const staff = actor.staffUserId
      ? await this.prisma.staffUser.findUnique({
          where: { id: actor.staffUserId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const byLabel = staff ? `${staff.lastName}, ${staff.firstName}` : '';
    const timezone = original.branch.restaurant.timezone || DEFAULT_TIMEZONE;
    const ticketId = original.stationTicketId;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM station_tickets WHERE id = ${ticketId}::uuid FOR UPDATE`;

      const existing = await tx.printJob.findMany({
        where: {
          stationTicketId: ticketId,
          printerId: original.printerId,
          kind: PrintJobKind.COMANDA,
        },
        select: { idempotencyKey: true },
      });
      const next =
        existing.reduce((max, row) => {
          const match = REPRINT_KEY.exec(row.idempotencyKey);

          return match ? Math.max(max, Number(match[1])) : max;
        }, 0) + 1;

      return tx.printJob.create({
        data: {
          branchId: original.branchId,
          printerId: original.printerId,
          stationTicketId: ticketId,
          kind: PrintJobKind.COMANDA,
          reprintOfId: original.id,
          idempotencyKey: jobIdempotencyKey(
            ticketId,
            original.printerId,
            `R${next}`,
          ),
          document: buildReprintDocument(original.document as never, {
            reprintNumber: next,
            now: new Date(),
            timezone,
            byLabel,
          }),
        },
      });
    });

    await this.audit.record(null, {
      restaurantId: actor.restaurantId,
      branchId: actor.branchId,
      actorStaffUserId: actor.staffUserId,
      actorRole: actor.role,
      action: 'PRINT_JOB_REPRINTED',
      entityType: 'PrintJob',
      entityId: created.id,
      after: { reprintOfId: original.id },
    });

    return created;
  }

  async reprintStationTicket(
    stationTicketId: string,
    actor: ReprintActor,
  ): Promise<PrintJob[]> {
    const originals = await this.prisma.printJob.findMany({
      where: {
        stationTicketId,
        branchId: actor.branchId,
        kind: PrintJobKind.COMANDA,
        reprintOfId: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    if (originals.length === 0) {
      throw new NotFoundException('La comanda no tiene trabajos de impresion.');
    }

    const created: PrintJob[] = [];

    for (const original of originals) {
      created.push(await this.reprintJob(original.id, actor));
    }

    return created;
  }
}
