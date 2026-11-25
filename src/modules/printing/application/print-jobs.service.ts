import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, type PrintJob, type Printer } from '@prisma/client';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { DEFAULT_TIMEZONE, formatDisplayNumber } from '../domain/business-day';
import { buildReceiptDocument } from '../domain/receipt-builder';
import { isReceiptDocument } from '../domain/receipt-document';
import type {
  ListPrintJobsQueryDto,
  SamplePreviewQueryDto,
} from '../presentation/http/dto/printing.dto';
import { documentOf, renderPrinterHtml, renderPrinterText } from './render-job';
import { PRINT_READ_ROLES } from './printers.service';
import { PrintQueueService } from './print-queue.service';
import { PrintWakeService } from './print-wake.service';
import { ReprintService } from './reprint.service';

export const PRINT_REPRINT_ROLES: Role[] = [
  Role.ADMIN,
  Role.SUPERVISOR,
  Role.KITCHEN,
  Role.BAR,
];
const DEFAULT_LIMIT = 50;
const DEFAULT_COLUMNS = 32;
const DEFAULT_PAPER_MM = 58;

type JobWithPrinter = PrintJob & {
  printer: { name: string };
};

export type PrintJobResponse = {
  id: string;
  printerId: string;
  printerName: string;
  stationTicketId: string | null;
  kind: PrintJob['kind'];
  status: PrintJob['status'];
  displayNumber: string | null;
  stationName: string | null;
  attempts: number;
  duplicateAcks: number;
  reprintOfId: string | null;
  reprintNumber: number | null;
  claimedByDeviceId: string | null;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
  printedAt: string | null;
};

export type PrintPreviewResponse = {
  jobId: string | null;
  status: PrintJob['status'] | null;
  columns: number;
  paperWidthMm: number;
  text: string;
  html: string;
  htmlDocument: string;
  document: unknown;
};

function reprintNumberOf(job: Pick<PrintJob, 'idempotencyKey'>): number | null {
  const n = Number(/:R(\d+)$/.exec(job.idempotencyKey)?.[1] ?? 0);

  return n > 0 ? n : null;
}

export function mapPrintJob(job: JobWithPrinter): PrintJobResponse {
  const doc = documentOf(job);

  return {
    id: job.id,
    printerId: job.printerId,
    printerName: job.printer.name,
    stationTicketId: job.stationTicketId,
    kind: job.kind,
    status: job.status,
    displayNumber: doc?.header.number ?? null,
    stationName: doc?.header.station ?? null,
    attempts: job.attempts,
    duplicateAcks: job.duplicateAcks,
    reprintOfId: job.reprintOfId,
    reprintNumber: reprintNumberOf(job),
    claimedByDeviceId: job.claimedByDeviceId,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
    nextAttemptAt: job.nextAttemptAt.toISOString(),
    printedAt: job.printedAt?.toISOString() ?? null,
  };
}

function renderPreview(
  doc: Parameters<typeof renderPrinterText>[0],
  printer: Pick<Printer, 'columns' | 'paperWidthMm' | 'copies'>,
  jobId: string | null,
  status: PrintJob['status'] | null,
): PrintPreviewResponse {
  const full = printer as Printer;

  return {
    jobId,
    status,
    columns: printer.columns,
    paperWidthMm: printer.paperWidthMm,
    text: renderPrinterText(doc, full),
    html: renderPrinterHtml(doc, full, false),
    htmlDocument: renderPrinterHtml(doc, full, true),
    document: doc,
  };
}

@Injectable()
export class PrintJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly queue: PrintQueueService,
    private readonly reprints: ReprintService,
    private readonly wake: PrintWakeService,
  ) {}

  async list(
    authUser: JwtPayload,
    branchId: string,
    query: ListPrintJobsQueryDto,
  ): Promise<PrintJobResponse[]> {
    await this.branchAccess.ensureAccess(authUser, branchId, PRINT_READ_ROLES);

    const createdAt: Prisma.DateTimeFilter = {};

    if (query.from) {
      createdAt.gte = new Date(query.from);
    }

    if (query.to) {
      createdAt.lte = new Date(query.to);
    }

    if (query.before) {
      createdAt.lt = new Date(query.before);
    }

    const jobs = await this.prisma.printJob.findMany({
      where: {
        branchId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.printerId ? { printerId: query.printerId } : {}),
        ...(query.stationTicketId
          ? { stationTicketId: query.stationTicketId }
          : {}),
        ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      },
      include: { printer: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? DEFAULT_LIMIT,
    });

    return jobs.map(mapPrintJob);
  }

  async get(
    authUser: JwtPayload,
    branchId: string,
    jobId: string,
  ): Promise<PrintJobResponse & { document: unknown }> {
    await this.branchAccess.ensureAccess(authUser, branchId, PRINT_READ_ROLES);
    const job = await this.loadJob(branchId, jobId);

    return { ...mapPrintJob(job), document: job.document };
  }

  async preview(
    authUser: JwtPayload,
    branchId: string,
    jobId: string,
  ): Promise<PrintPreviewResponse> {
    await this.branchAccess.ensureAccess(authUser, branchId, PRINT_READ_ROLES);
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, branchId },
      include: { printer: true },
    });

    if (!job) {
      throw new NotFoundException('El trabajo indicado no existe.');
    }

    if (!isReceiptDocument(job.document)) {
      throw new BadRequestException('El trabajo no tiene un documento valido.');
    }

    return renderPreview(job.document, job.printer, job.id, job.status);
  }

  async samplePreview(
    authUser: JwtPayload,
    branchId: string,
    query: SamplePreviewQueryDto,
  ): Promise<PrintPreviewResponse> {
    await this.branchAccess.ensureAccess(authUser, branchId, PRINT_READ_ROLES);

    const printer = query.printerId
      ? await this.prisma.printer.findFirst({
          where: { id: query.printerId, branchId },
        })
      : null;

    if (query.printerId && !printer) {
      throw new NotFoundException('La impresora indicada no existe.');
    }

    const station = query.stationId
      ? await this.prisma.preparationStation.findFirst({
          where: { id: query.stationId, branchId },
        })
      : null;

    if (query.stationId && !station) {
      throw new NotFoundException('La estacion indicada no existe.');
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { restaurant: { select: { timezone: true } } },
    });
    const now = new Date();
    const doc = buildReceiptDocument(
      {
        stationName: station?.name ?? 'pizza',
        displayNumber: formatDisplayNumber(station?.printCode ?? '01', 23),
        sentAt: now,
        timezone: branch?.restaurant.timezone || DEFAULT_TIMEZONE,
        isCounter: false,
        ticketNumber: null,
        tableCode: '7',
        customerLabel: 'Pedro',
        orderNotes: 'sin sal en todo',
        isQrOrder: false,
        staff: { firstName: 'Juanita', lastName: 'Cajero' },
        items: [
          {
            quantity: 1,
            name: 'Pizza 3 quesos',
            notes: 'sin oregano',
            options: ['Masa > Delgada'],
          },
          {
            quantity: 2,
            name: 'pizza hawaiana',
            notes: null,
            options: ['Extra > Queso'],
          },
        ],
      },
      { copies: 1 },
    );
    const layout = {
      columns: query.columns ?? printer?.columns ?? DEFAULT_COLUMNS,
      paperWidthMm:
        query.paperWidthMm ?? printer?.paperWidthMm ?? DEFAULT_PAPER_MM,
      copies: 1,
    };

    return renderPreview(doc, layout, null, null);
  }

  async reprint(
    authUser: JwtPayload,
    branchId: string,
    jobId: string,
  ): Promise<PrintJobResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_REPRINT_ROLES,
    );
    const created = await this.reprints.reprintJob(jobId, {
      restaurantId: context.restaurantId,
      branchId,
      staffUserId: context.staffUserId,
      role: context.roles.find((r) => PRINT_REPRINT_ROLES.includes(r)) ?? null,
    });

    this.wake.notifyBranch(branchId);

    return mapPrintJob(await this.loadJob(branchId, created.id));
  }

  async reprintTicket(
    authUser: JwtPayload,
    branchId: string,
    stationTicketId: string,
  ): Promise<PrintJobResponse[]> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_REPRINT_ROLES,
    );
    const created = await this.reprints.reprintStationTicket(stationTicketId, {
      restaurantId: context.restaurantId,
      branchId,
      staffUserId: context.staffUserId,
      role: context.roles.find((r) => PRINT_REPRINT_ROLES.includes(r)) ?? null,
    });

    this.wake.notifyBranch(branchId);

    return Promise.all(
      created.map(async (job) =>
        mapPrintJob(await this.loadJob(branchId, job.id)),
      ),
    );
  }

  async retry(
    authUser: JwtPayload,
    branchId: string,
    jobId: string,
  ): Promise<PrintJobResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_READ_ROLES,
    );
    const ok = await this.queue.manualRetry(jobId, {
      restaurantId: context.restaurantId,
      branchId,
      staffUserId: context.staffUserId,
    });

    if (!ok) {
      throw new ConflictException({
        message: 'Solo se pueden reintentar trabajos fallidos.',
        code: 'PRINT_JOB_NOT_RETRYABLE',
      });
    }

    this.wake.notifyBranch(branchId);

    return mapPrintJob(await this.loadJob(branchId, jobId));
  }

  private async loadJob(
    branchId: string,
    jobId: string,
  ): Promise<JobWithPrinter> {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, branchId },
      include: { printer: { select: { name: true } } },
    });

    if (!job) {
      throw new NotFoundException('El trabajo indicado no existe.');
    }

    return job;
  }
}
