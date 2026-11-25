import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PrintJobKind,
  PrintJobStatus,
  Role,
  type Printer,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { DEFAULT_TIMEZONE } from '../domain/business-day';
import {
  isSupportedCodepage,
  validateConnection,
} from '../domain/printer-config';
import { buildTestDocument } from '../domain/receipt-builder';
import type {
  CreatePrinterDto,
  UpdatePrinterDto,
  UpdatePrintStationDto,
} from '../presentation/http/dto/printing.dto';
import { PrintWakeService } from './print-wake.service';
import { PrintingConfigService } from './printing-config.service';

export const PRINT_ADMIN_ROLES: Role[] = [Role.ADMIN];
export const PRINT_READ_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR];

export type PrinterWithLinks = Printer & {
  stations: { preparationStationId: string }[];
  devices: { deviceId: string }[];
};

export type PrinterResponse = {
  id: string;
  branchId: string;
  name: string;
  transport: Printer['transport'];
  connection: Prisma.JsonValue;
  paperWidthMm: number;
  columns: number;
  codepage: string;
  escTCodepageId: number | null;
  copies: number;
  autoCut: boolean;
  cashDrawer: boolean;
  printVoidSlips: boolean;
  active: boolean;
  status: Printer['status'];
  lastSeenAt: string | null;
  lastError: string | null;
  stationIds: string[];
  deviceIds: string[];
};

export type PrintStationResponse = {
  stationId: string;
  name: string;
  stationType: string;
  printCode: string | null;
  printerIds: string[];
};

const LINKS_INCLUDE = {
  stations: { select: { preparationStationId: true } },
  devices: { select: { deviceId: true } },
} satisfies Prisma.PrinterInclude;

export function mapPrinter(printer: PrinterWithLinks): PrinterResponse {
  return {
    id: printer.id,
    branchId: printer.branchId,
    name: printer.name,
    transport: printer.transport,
    connection: printer.connection,
    paperWidthMm: printer.paperWidthMm,
    columns: printer.columns,
    codepage: printer.codepage,
    escTCodepageId: printer.escTCodepageId,
    copies: printer.copies,
    autoCut: printer.autoCut,
    cashDrawer: printer.cashDrawer,
    printVoidSlips: printer.printVoidSlips,
    active: printer.active,
    status: printer.status,
    lastSeenAt: printer.lastSeenAt?.toISOString() ?? null,
    lastError: printer.lastError,
    stationIds: printer.stations.map((s) => s.preparationStationId),
    deviceIds: printer.devices.map((d) => d.deviceId),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class PrintersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly audit: AuditService,
    private readonly config: PrintingConfigService,
    private readonly wake: PrintWakeService,
  ) {}

  async list(authUser: JwtPayload, branchId: string) {
    await this.branchAccess.ensureAccess(authUser, branchId, PRINT_READ_ROLES);
    const printers = await this.prisma.printer.findMany({
      where: { branchId },
      include: LINKS_INCLUDE,
      orderBy: { name: 'asc' },
    });

    return printers.map(mapPrinter);
  }

  async get(authUser: JwtPayload, branchId: string, printerId: string) {
    await this.branchAccess.ensureAccess(authUser, branchId, PRINT_READ_ROLES);

    return mapPrinter(await this.loadPrinter(branchId, printerId));
  }

  async create(
    authUser: JwtPayload,
    branchId: string,
    dto: CreatePrinterDto,
  ): Promise<PrinterResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );
    const name = dto.name.trim();
    const connection = this.connectionOrThrow(dto.transport, dto.connection);

    this.assertCodepage(dto.codepage);
    await this.assertNameFree(branchId, name);
    await this.assertStations(branchId, dto.stationIds);

    const created = await this.prisma
      .$transaction(async (tx) => {
        const printer = await tx.printer.create({
          data: {
            branchId,
            name,
            transport: dto.transport,
            connection: connection as Prisma.InputJsonValue,
            ...(dto.paperWidthMm !== undefined
              ? { paperWidthMm: dto.paperWidthMm }
              : {}),
            ...(dto.columns !== undefined ? { columns: dto.columns } : {}),
            ...(dto.codepage !== undefined ? { codepage: dto.codepage } : {}),
            ...(dto.escTCodepageId !== undefined
              ? { escTCodepageId: dto.escTCodepageId }
              : {}),
            ...(dto.copies !== undefined ? { copies: dto.copies } : {}),
            ...(dto.autoCut !== undefined ? { autoCut: dto.autoCut } : {}),
            ...(dto.cashDrawer !== undefined
              ? { cashDrawer: dto.cashDrawer }
              : {}),
            ...(dto.printVoidSlips !== undefined
              ? { printVoidSlips: dto.printVoidSlips }
              : {}),
            ...(dto.active !== undefined ? { active: dto.active } : {}),
            stations: {
              create: (dto.stationIds ?? []).map((id) => ({
                preparationStationId: id,
              })),
            },
          },
          include: LINKS_INCLUDE,
        });

        await this.audit.record(tx, {
          restaurantId: context.restaurantId,
          branchId,
          actorStaffUserId: context.staffUserId,
          actorRole: Role.ADMIN,
          action: 'PRINTER_CREATED',
          entityType: 'Printer',
          entityId: printer.id,
          after: { name, transport: dto.transport },
        });

        return printer;
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            'Ya existe una impresora con ese nombre en la sucursal.',
          );
        }

        throw error;
      });

    return mapPrinter(created);
  }

  async update(
    authUser: JwtPayload,
    branchId: string,
    printerId: string,
    dto: UpdatePrinterDto,
  ): Promise<PrinterResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );
    const current = await this.loadPrinter(branchId, printerId);
    const name = dto.name?.trim();

    if (name && name !== current.name) {
      await this.assertNameFree(branchId, name);
    }

    this.assertCodepage(dto.codepage);

    const transport = dto.transport ?? current.transport;
    const connectionTouched =
      dto.connection !== undefined || dto.transport !== undefined;
    const connection = connectionTouched
      ? this.connectionOrThrow(
          transport,
          dto.connection ??
            (dto.transport === undefined
              ? (current.connection as Record<string, unknown>)
              : undefined),
        )
      : null;

    const updated = await this.prisma.printer
      .update({
        where: { id: printerId },
        data: {
          ...(name ? { name } : {}),
          ...(dto.transport ? { transport: dto.transport } : {}),
          ...(connection
            ? { connection: connection as Prisma.InputJsonValue }
            : {}),
          ...(dto.paperWidthMm !== undefined
            ? { paperWidthMm: dto.paperWidthMm }
            : {}),
          ...(dto.columns !== undefined ? { columns: dto.columns } : {}),
          ...(dto.codepage !== undefined ? { codepage: dto.codepage } : {}),
          ...(dto.escTCodepageId !== undefined
            ? { escTCodepageId: dto.escTCodepageId }
            : {}),
          ...(dto.copies !== undefined ? { copies: dto.copies } : {}),
          ...(dto.autoCut !== undefined ? { autoCut: dto.autoCut } : {}),
          ...(dto.cashDrawer !== undefined
            ? { cashDrawer: dto.cashDrawer }
            : {}),
          ...(dto.printVoidSlips !== undefined
            ? { printVoidSlips: dto.printVoidSlips }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        include: LINKS_INCLUDE,
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            'Ya existe una impresora con ese nombre en la sucursal.',
          );
        }

        throw error;
      });

    if (dto.transport && dto.transport !== current.transport) {
      await this.prisma.printDevicePrinter.deleteMany({
        where: { printerId },
      });
    }

    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINTER_UPDATED',
      entityType: 'Printer',
      entityId: printerId,
      before: { name: current.name, transport: current.transport },
      after: { name: updated.name, transport: updated.transport },
    });

    return mapPrinter(updated);
  }

  async remove(
    authUser: JwtPayload,
    branchId: string,
    printerId: string,
  ): Promise<void> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );
    const printer = await this.loadPrinter(branchId, printerId);
    const inProgress = await this.prisma.printJob.count({
      where: { printerId, status: PrintJobStatus.CLAIMED },
    });

    if (inProgress > 0) {
      throw new ConflictException({
        message:
          'La impresora tiene trabajos en curso: espera a que terminen e intenta de nuevo.',
        code: 'PRINTER_HAS_OPEN_JOBS',
      });
    }

    const removedJobs = await this.prisma.$transaction(async (tx) => {
      const count = await tx.printJob.count({ where: { printerId } });

      await tx.printer.delete({ where: { id: printerId } });

      return count;
    });
    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINTER_DELETED',
      entityType: 'Printer',
      entityId: printerId,
      before: { name: printer.name },
      after: { removedJobs },
    });
  }

  async setStations(
    authUser: JwtPayload,
    branchId: string,
    printerId: string,
    stationIds: string[],
  ): Promise<PrinterResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );

    await this.loadPrinter(branchId, printerId);
    await this.assertStations(branchId, stationIds);

    const ids = Array.from(new Set(stationIds));

    await this.prisma.$transaction([
      this.prisma.printerStation.deleteMany({
        where: { printerId, preparationStationId: { notIn: ids } },
      }),
      this.prisma.printerStation.createMany({
        data: ids.map((id) => ({ printerId, preparationStationId: id })),
        skipDuplicates: true,
      }),
    ]);
    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINTER_UPDATED',
      entityType: 'Printer',
      entityId: printerId,
      after: { stationIds: ids },
    });

    return mapPrinter(await this.loadPrinter(branchId, printerId));
  }

  async listStations(
    authUser: JwtPayload,
    branchId: string,
  ): Promise<PrintStationResponse[]> {
    await this.branchAccess.ensureAccess(authUser, branchId, PRINT_READ_ROLES);
    const stations = await this.prisma.preparationStation.findMany({
      where: { branchId },
      include: { printers: { select: { printerId: true } } },
      orderBy: { name: 'asc' },
    });

    return stations.map((s) => ({
      stationId: s.id,
      name: s.name,
      stationType: s.stationType,
      printCode: s.printCode,
      printerIds: s.printers.map((p) => p.printerId),
    }));
  }

  async updateStation(
    authUser: JwtPayload,
    branchId: string,
    stationId: string,
    dto: UpdatePrintStationDto,
  ): Promise<PrintStationResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );
    const station = await this.prisma.preparationStation.findFirst({
      where: { id: stationId, branchId },
    });

    if (!station) {
      throw new NotFoundException('La estacion indicada no existe.');
    }

    if (dto.printerIds) {
      const unique = Array.from(new Set(dto.printerIds));
      const found = await this.prisma.printer.count({
        where: { id: { in: unique }, branchId },
      });

      if (found !== unique.length) {
        throw new BadRequestException(
          'Alguna impresora no pertenece a la sucursal.',
        );
      }
    }

    const printCode =
      dto.printCode === undefined
        ? undefined
        : (dto.printCode?.toUpperCase() ?? null);

    await this.prisma
      .$transaction(async (tx) => {
        if (printCode !== undefined) {
          await tx.preparationStation.update({
            where: { id: stationId },
            data: { printCode },
          });
        }

        if (dto.printerIds) {
          const ids = Array.from(new Set(dto.printerIds));

          await tx.printerStation.deleteMany({
            where: {
              preparationStationId: stationId,
              printerId: { notIn: ids },
            },
          });
          await tx.printerStation.createMany({
            data: ids.map((printerId) => ({
              printerId,
              preparationStationId: stationId,
            })),
            skipDuplicates: true,
          });
        }
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error)) {
          throw new ConflictException({
            message: 'Ya existe otra estacion con ese codigo de impresion.',
            code: 'PRINT_CODE_TAKEN',
          });
        }

        throw error;
      });

    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINT_STATION_UPDATED',
      entityType: 'PreparationStation',
      entityId: stationId,
      before: { printCode: station.printCode },
      after: {
        ...(printCode !== undefined ? { printCode } : {}),
        ...(dto.printerIds ? { printerIds: dto.printerIds } : {}),
      },
    });

    const [result] = (await this.listStations(authUser, branchId)).filter(
      (s) => s.stationId === stationId,
    );

    return result;
  }

  async testPrint(
    authUser: JwtPayload,
    branchId: string,
    printerId: string,
  ): Promise<{ jobId: string }> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );
    const printer = await this.loadPrinter(branchId, printerId);

    if (!printer.active) {
      throw new ConflictException({
        message: 'La impresora esta desactivada.',
        code: 'PRINTER_INACTIVE',
      });
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { restaurant: { select: { timezone: true } } },
    });
    const job = await this.prisma.printJob.create({
      data: {
        branchId,
        printerId,
        kind: PrintJobKind.TEST,
        idempotencyKey: `TEST:${randomUUID()}`,
        document: buildTestDocument({
          printerName: printer.name,
          now: new Date(),
          timezone: branch?.restaurant.timezone || DEFAULT_TIMEZONE,
        }),
      },
    });

    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINT_TEST_ENQUEUED',
      entityType: 'PrintJob',
      entityId: job.id,
      after: { printerId },
    });
    this.wake.notifyBranch(branchId);

    return { jobId: job.id };
  }

  async loadPrinter(
    branchId: string,
    printerId: string,
  ): Promise<PrinterWithLinks> {
    const printer = await this.prisma.printer.findFirst({
      where: { id: printerId, branchId },
      include: LINKS_INCLUDE,
    });

    if (!printer) {
      throw new NotFoundException('La impresora indicada no existe.');
    }

    return printer;
  }

  private connectionOrThrow(
    transport: Printer['transport'],
    value: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const result = validateConnection(
      transport,
      value,
      this.config.tcpAllowLocal,
    );

    if (!result.ok) {
      throw new BadRequestException(result.message);
    }

    return result.connection;
  }

  private assertCodepage(codepage: string | undefined): void {
    if (codepage !== undefined && !isSupportedCodepage(codepage)) {
      throw new BadRequestException('La codepage indicada no esta soportada.');
    }
  }

  private async assertNameFree(branchId: string, name: string): Promise<void> {
    const existing = await this.prisma.printer.findFirst({
      where: { branchId, name },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Ya existe una impresora con ese nombre en la sucursal.',
      );
    }
  }

  private async assertStations(
    branchId: string,
    stationIds: string[] | undefined,
  ): Promise<void> {
    if (!stationIds || stationIds.length === 0) {
      return;
    }

    const unique = Array.from(new Set(stationIds));
    const found = await this.prisma.preparationStation.count({
      where: { id: { in: unique }, branchId },
    });

    if (found !== unique.length) {
      throw new BadRequestException(
        'Alguna estacion no pertenece a la sucursal.',
      );
    }
  }
}
