import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PrintJobKind,
  PrintJobStatus,
  StationTicketStatus,
  type PrintJob,
  type Printer,
  type PrinterTransport,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { decideFailure, MANUAL_RETRY_MARK } from '../domain/print-job-state';
import { PrintAlertsService } from './print-alerts.service';
import { PrintingConfigService } from './printing-config.service';

const MAX_ERROR_LENGTH = 500;

export type ClaimInput = {
  transports?: PrinterTransport[];
  deviceId?: string;
  branchId?: string;
  limit: number;
  leaseSeconds: number;
  claimedBy: string | null;
};

export type ClaimedJob = {
  job: PrintJob;
  printer: Printer;
  retryUncertain: boolean;
};

export type AckResult = 'PRINTED' | 'DUPLICATE' | 'IGNORED' | 'NOT_FOUND';

export type FailInput = {
  code: string;
  message: string;
  retryable: boolean;
  branchId?: string;
};

export type FailResult = 'PENDING' | 'FAILED' | 'IGNORED';

const STALE_TICKET_STATUSES: StationTicketStatus[] = [
  StationTicketStatus.READY,
  StationTicketStatus.CANCELLED,
];

const ORIGINAL_KEY = /:R0$/;

function isOriginalJob(
  job: Pick<PrintJob, 'reprintOfId' | 'idempotencyKey' | 'lastError'>,
): boolean {
  return (
    job.reprintOfId === null &&
    ORIGINAL_KEY.test(job.idempotencyKey) &&
    !job.lastError?.startsWith(MANUAL_RETRY_MARK)
  );
}

@Injectable()
export class PrintQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PrintingConfigService,
    private readonly audit: AuditService,
    private readonly alerts: PrintAlertsService,
  ) {}

  async claim(input: ClaimInput): Promise<ClaimedJob[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`(
        (j.status = 'PENDING' AND j.next_attempt_at <= now())
        OR (j.status = 'CLAIMED' AND j.lease_until < now() AND j.attempts < ${this.config.maxAttempts}::int)
      )`,
    ];

    if (input.transports) {
      conditions.push(
        Prisma.sql`p.transport::text = ANY(${input.transports}::text[])`,
      );
    }

    if (input.branchId) {
      conditions.push(Prisma.sql`j.branch_id = ${input.branchId}::uuid`);
    }

    const deviceJoin = input.deviceId
      ? Prisma.sql`JOIN print_device_printers dp ON dp.printer_id = j.printer_id AND dp.device_id = ${input.deviceId}::uuid`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { id: string; was_claimed: boolean }[]
    >(Prisma.sql`
      WITH due AS (
        SELECT j.id, (j.status = 'CLAIMED') AS was_claimed
        FROM print_jobs j
        JOIN printers p ON p.id = j.printer_id AND p.active
        ${deviceJoin}
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY j.created_at ASC
        LIMIT ${input.limit}::int
        FOR UPDATE OF j SKIP LOCKED
      )
      UPDATE print_jobs t
      SET status = 'CLAIMED',
          claimed_by_device_id = ${input.deviceId ?? null}::uuid,
          claimed_by = ${input.claimedBy},
          lease_until = now() + make_interval(secs => ${input.leaseSeconds}::double precision),
          attempts = t.attempts + 1,
          updated_at = now()
      FROM due
      WHERE t.id = due.id
      RETURNING t.id, due.was_claimed
    `);

    if (rows.length === 0) {
      return [];
    }

    const uncertain = new Map(rows.map((r) => [r.id, r.was_claimed]));
    const jobs = await this.prisma.printJob.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: {
        printer: true,
        stationTicket: { select: { status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const stale = jobs.filter(
      (j) =>
        j.kind === PrintJobKind.COMANDA &&
        isOriginalJob(j) &&
        j.stationTicket &&
        STALE_TICKET_STATUSES.includes(j.stationTicket.status),
    );

    if (stale.length > 0) {
      await this.prisma.printJob.updateMany({
        where: { id: { in: stale.map((j) => j.id) } },
        data: {
          status: PrintJobStatus.CANCELLED,
          leaseUntil: null,
          lastError: 'TICKET_NOT_PENDING',
        },
      });
    }

    const staleIds = new Set(stale.map((j) => j.id));

    return jobs
      .filter((j) => !staleIds.has(j.id))
      .map((job) => ({
        job,
        printer: job.printer,
        retryUncertain: uncertain.get(job.id) ?? false,
      }));
  }

  async ack(
    jobId: string,
    options: { printedAt?: Date; branchId?: string } = {},
  ): Promise<AckResult> {
    const scope = options.branchId ? { branchId: options.branchId } : {};
    const result = await this.prisma.printJob.updateMany({
      where: {
        id: jobId,
        ...scope,
        status: {
          in: [
            PrintJobStatus.CLAIMED,
            PrintJobStatus.PENDING,
            PrintJobStatus.FAILED,
          ],
        },
      },
      data: {
        status: PrintJobStatus.PRINTED,
        printedAt: options.printedAt ?? new Date(),
        leaseUntil: null,
        lastError: null,
      },
    });

    if (result.count > 0) {
      return 'PRINTED';
    }

    const current = await this.prisma.printJob.findFirst({
      where: { id: jobId, ...scope },
      select: { status: true },
    });

    if (!current) {
      return 'NOT_FOUND';
    }

    if (current.status === PrintJobStatus.PRINTED) {
      await this.prisma.printJob.update({
        where: { id: jobId },
        data: { duplicateAcks: { increment: 1 } },
      });
      return 'DUPLICATE';
    }

    return 'IGNORED';
  }

  async fail(jobId: string, input: FailInput): Promise<FailResult> {
    const job = await this.prisma.printJob.findFirst({
      where: {
        id: jobId,
        status: PrintJobStatus.CLAIMED,
        ...(input.branchId ? { branchId: input.branchId } : {}),
      },
      include: {
        printer: { select: { name: true } },
        branch: { select: { restaurantId: true } },
      },
    });

    if (!job) {
      return 'IGNORED';
    }

    const decision = decideFailure({
      retryable: input.retryable,
      attempts: job.attempts,
      maxAttempts: this.config.maxAttempts,
      now: new Date(),
      baseMs: this.config.retryBaseMs,
    });
    const mark = job.lastError?.startsWith(MANUAL_RETRY_MARK)
      ? `${MANUAL_RETRY_MARK} `
      : '';
    const lastError = `${mark}[${input.code}] ${input.message}`.slice(
      0,
      MAX_ERROR_LENGTH,
    );
    const result = await this.prisma.printJob.updateMany({
      where: { id: job.id, status: PrintJobStatus.CLAIMED },
      data: {
        status: decision.status,
        leaseUntil: null,
        lastError,
        ...(decision.nextAttemptAt
          ? { nextAttemptAt: decision.nextAttemptAt }
          : {}),
      },
    });

    if (result.count === 0) {
      return 'IGNORED';
    }

    if (decision.status === 'FAILED') {
      await this.alerts.jobFailed(
        {
          restaurantId: job.branch.restaurantId,
          branchId: job.branchId,
          entityType: 'PrintJob',
          entityId: job.id,
        },
        {
          printerName: job.printer.name,
          code: input.code,
          displayNumber: this.displayNumberOf(job),
        },
      );
    }

    return decision.status;
  }

  async release(jobIds: string[], deviceId: string): Promise<number> {
    if (jobIds.length === 0) {
      return 0;
    }

    const result = await this.prisma.printJob.updateMany({
      where: {
        id: { in: jobIds },
        status: PrintJobStatus.CLAIMED,
        claimedByDeviceId: deviceId,
        attempts: { gt: 0 },
      },
      data: {
        status: PrintJobStatus.PENDING,
        leaseUntil: null,
        nextAttemptAt: new Date(),
        attempts: { decrement: 1 },
      },
    });

    return result.count;
  }

  async extend(
    jobId: string,
    branchId?: string,
    leaseSeconds = this.config.deviceLeaseSeconds,
  ): Promise<boolean> {
    const result = await this.prisma.printJob.updateMany({
      where: {
        id: jobId,
        status: PrintJobStatus.CLAIMED,
        ...(branchId ? { branchId } : {}),
      },
      data: {
        leaseUntil: new Date(Date.now() + leaseSeconds * 1000),
      },
    });

    return result.count > 0;
  }

  async manualRetry(
    jobId: string,
    actor: {
      restaurantId: string;
      branchId: string;
      staffUserId: string | null;
    },
  ): Promise<boolean> {
    const result = await this.prisma.printJob.updateMany({
      where: {
        id: jobId,
        branchId: actor.branchId,
        status: PrintJobStatus.FAILED,
      },
      data: {
        status: PrintJobStatus.PENDING,
        attempts: 0,
        nextAttemptAt: new Date(),
        leaseUntil: null,
        lastError: MANUAL_RETRY_MARK,
      },
    });

    if (result.count === 0) {
      return false;
    }

    await this.audit.record(null, {
      restaurantId: actor.restaurantId,
      branchId: actor.branchId,
      actorStaffUserId: actor.staffUserId,
      actorRole: null,
      action: 'PRINT_JOB_RETRIED',
      entityType: 'PrintJob',
      entityId: jobId,
    });

    return true;
  }

  private displayNumberOf(job: PrintJob): string | undefined {
    const doc = job.document as { header?: { number?: unknown } } | null;
    const number = doc?.header?.number;

    return typeof number === 'string' ? number : undefined;
  }
}
