import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PrintDeviceKind,
  PrintJobStatus,
  Prisma,
  Role,
  type PrintDevice,
  type PrinterTransport,
} from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import {
  generatePairingCode,
  hashPairingCode,
  transportsServedBy,
} from '../domain/device-security';
import type {
  CreatePrintDeviceDto,
  UpdatePrintDeviceDto,
} from '../presentation/http/dto/printing.dto';
import { PRINT_ADMIN_ROLES, PRINT_READ_ROLES } from './printers.service';
import { PrintingConfigService } from './printing-config.service';

const DEFAULT_DEVICE_NAME = 'Dispositivo';
const CODE_ATTEMPTS = 20;

type DeviceWithPrinters = PrintDevice & {
  printers: { printerId: string }[];
};

export type PrintDeviceResponse = {
  id: string;
  branchId: string;
  kind: PrintDeviceKind;
  name: string;
  active: boolean;
  paired: boolean;
  pairingPending: boolean;
  pairingExpiresAt: string | null;
  appVersion: string | null;
  lastSeenAt: string | null;
  online: boolean;
  printerIds: string[];
};

export type PairingCodeResponse = {
  device: PrintDeviceResponse;
  pairingCode: string;
  expiresAt: string;
};

export async function releaseDeviceClaims(
  tx: Prisma.TransactionClient,
  deviceId: string,
): Promise<number> {
  const where = {
    claimedByDeviceId: deviceId,
    status: PrintJobStatus.CLAIMED,
  };
  const data = {
    status: PrintJobStatus.PENDING,
    leaseUntil: null,
    nextAttemptAt: new Date(),
    lastError: 'DEVICE_REVOKED',
  };
  const counted = await tx.printJob.updateMany({
    where: { ...where, attempts: { gt: 0 } },
    data: { ...data, attempts: { decrement: 1 } },
  });
  const rest = await tx.printJob.updateMany({ where, data });

  return counted.count + rest.count;
}

export async function replaceDevicePrinters(
  prisma: PrismaService,
  input: {
    deviceId: string;
    branchId: string;
    kind: PrintDeviceKind;
    printerIds: string[];
  },
): Promise<void> {
  const ids = Array.from(new Set(input.printerIds));
  const allowed: PrinterTransport[] = transportsServedBy(input.kind);

  if (ids.length > 0) {
    const found = await prisma.printer.count({
      where: {
        id: { in: ids },
        branchId: input.branchId,
        transport: { in: allowed },
      },
    });

    if (found !== ids.length) {
      throw new BadRequestException(
        'Alguna impresora no existe en la sucursal o no puede ser atendida por este tipo de dispositivo.',
      );
    }
  }

  await prisma.$transaction([
    prisma.printDevicePrinter.deleteMany({
      where: { deviceId: input.deviceId, printerId: { notIn: ids } },
    }),
    prisma.printDevicePrinter.createMany({
      data: ids.map((printerId) => ({ deviceId: input.deviceId, printerId })),
      skipDuplicates: true,
    }),
  ]);
}

@Injectable()
export class PrintDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
    private readonly audit: AuditService,
    private readonly config: PrintingConfigService,
  ) {}

  async list(
    authUser: JwtPayload,
    branchId: string,
  ): Promise<PrintDeviceResponse[]> {
    await this.branchAccess.ensureAccess(authUser, branchId, PRINT_READ_ROLES);
    const devices = await this.prisma.printDevice.findMany({
      where: { branchId },
      include: { printers: { select: { printerId: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return devices.map((d) => this.map(d));
  }

  async createPairing(
    authUser: JwtPayload,
    branchId: string,
    dto: CreatePrintDeviceDto,
  ): Promise<PairingCodeResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );
    const kind = dto.kind ?? PrintDeviceKind.BROWSER;
    const created = await this.prisma.printDevice.create({
      data: {
        branchId,
        kind,
        name: dto.name?.trim() || DEFAULT_DEVICE_NAME,
      },
    });

    if (dto.printerIds) {
      await replaceDevicePrinters(this.prisma, {
        deviceId: created.id,
        branchId,
        kind,
        printerIds: dto.printerIds,
      }).catch(async (error: unknown) => {
        await this.prisma.printDevice.delete({ where: { id: created.id } });
        throw error;
      });
    }

    const issued = await this.issueCode(created.id);

    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINT_DEVICE_PAIRING_CREATED',
      entityType: 'PrintDevice',
      entityId: created.id,
      after: { kind },
    });

    return {
      device: await this.load(branchId, created.id),
      pairingCode: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  async regeneratePairing(
    authUser: JwtPayload,
    branchId: string,
    deviceId: string,
  ): Promise<PairingCodeResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );

    await this.loadRecord(branchId, deviceId);
    await this.prisma.printDevice.update({
      where: { id: deviceId },
      data: { tokenHash: null, active: true },
    });

    const issued = await this.issueCode(deviceId);

    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINT_DEVICE_PAIRING_CREATED',
      entityType: 'PrintDevice',
      entityId: deviceId,
      after: { repair: true },
    });

    return {
      device: await this.load(branchId, deviceId),
      pairingCode: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  async update(
    authUser: JwtPayload,
    branchId: string,
    deviceId: string,
    dto: UpdatePrintDeviceDto,
  ): Promise<PrintDeviceResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );
    const device = await this.loadRecord(branchId, deviceId);

    if (dto.name !== undefined) {
      await this.prisma.printDevice.update({
        where: { id: deviceId },
        data: { name: dto.name.trim() },
      });
    }

    if (dto.printerIds) {
      await replaceDevicePrinters(this.prisma, {
        deviceId,
        branchId,
        kind: device.kind,
        printerIds: dto.printerIds,
      });
    }

    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINT_DEVICE_UPDATED',
      entityType: 'PrintDevice',
      entityId: deviceId,
      after: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.printerIds ? { printerIds: dto.printerIds } : {}),
      },
    });

    return this.load(branchId, deviceId);
  }

  async revoke(
    authUser: JwtPayload,
    branchId: string,
    deviceId: string,
  ): Promise<PrintDeviceResponse> {
    const context = await this.branchAccess.ensureAccess(
      authUser,
      branchId,
      PRINT_ADMIN_ROLES,
    );

    await this.loadRecord(branchId, deviceId);
    const released = await this.prisma.$transaction(async (tx) => {
      await tx.printDevice.update({
        where: { id: deviceId },
        data: {
          active: false,
          tokenHash: null,
          pairingCodeHash: null,
          pairingExpiresAt: null,
        },
      });

      return releaseDeviceClaims(tx, deviceId);
    });

    await this.audit.record(null, {
      restaurantId: context.restaurantId,
      branchId,
      actorStaffUserId: context.staffUserId,
      actorRole: Role.ADMIN,
      action: 'PRINT_DEVICE_REVOKED',
      entityType: 'PrintDevice',
      entityId: deviceId,
      after: { releasedJobs: released },
    });

    return this.load(branchId, deviceId);
  }

  private async issueCode(
    deviceId: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    const expiresAt = new Date(
      Date.now() + this.config.pairingTtlMinutes * 60_000,
    );

    for (let i = 0; i < CODE_ATTEMPTS; i += 1) {
      const code = generatePairingCode();
      const hash = hashPairingCode(code, this.config.pairingSecret);
      const clash = await this.prisma.printDevice.findFirst({
        where: {
          pairingCodeHash: hash,
          pairingExpiresAt: { gt: new Date() },
        },
        select: { id: true },
      });

      if (!clash) {
        await this.prisma.printDevice.update({
          where: { id: deviceId },
          data: { pairingCodeHash: hash, pairingExpiresAt: expiresAt },
        });

        return { code, expiresAt };
      }
    }

    throw new BadRequestException(
      'No se pudo generar un codigo de emparejamiento. Intenta de nuevo.',
    );
  }

  private async loadRecord(
    branchId: string,
    deviceId: string,
  ): Promise<PrintDevice> {
    const device = await this.prisma.printDevice.findFirst({
      where: { id: deviceId, branchId },
    });

    if (!device) {
      throw new NotFoundException('El dispositivo indicado no existe.');
    }

    return device;
  }

  private async load(
    branchId: string,
    deviceId: string,
  ): Promise<PrintDeviceResponse> {
    const device = await this.prisma.printDevice.findFirstOrThrow({
      where: { id: deviceId, branchId },
      include: { printers: { select: { printerId: true } } },
    });

    return this.map(device);
  }

  private map(device: DeviceWithPrinters): PrintDeviceResponse {
    const now = Date.now();

    return {
      id: device.id,
      branchId: device.branchId,
      kind: device.kind,
      name: device.name,
      active: device.active,
      paired: device.tokenHash !== null,
      pairingPending:
        device.pairingCodeHash !== null &&
        !!device.pairingExpiresAt &&
        device.pairingExpiresAt.getTime() > now,
      pairingExpiresAt: device.pairingExpiresAt?.toISOString() ?? null,
      appVersion: device.appVersion,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      online:
        device.active &&
        !!device.lastSeenAt &&
        now - device.lastSeenAt.getTime() <=
          this.config.deviceOfflineSeconds * 1000,
      printerIds: device.printers.map((p) => p.printerId),
    };
  }
}
