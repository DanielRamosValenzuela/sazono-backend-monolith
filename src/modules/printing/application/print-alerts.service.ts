import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from '../../../common/audit/audit.service';
import { PushNotificationService } from '../../notifications/application/push-notification.service';
import { PrintingConfigService } from './printing-config.service';

type AlertTarget = {
  restaurantId: string;
  branchId: string;
  entityType: 'PrintJob' | 'Printer';
  entityId: string;
};

@Injectable()
export class PrintAlertsService {
  private readonly logger = new Logger(PrintAlertsService.name);
  private readonly lastPrinterAlert = new Map<string, number>();

  constructor(
    private readonly audit: AuditService,
    private readonly push: PushNotificationService,
    private readonly config: PrintingConfigService,
  ) {}

  async jobFailed(
    target: AlertTarget,
    info: { printerName: string; code: string; displayNumber?: string },
  ): Promise<void> {
    await this.record(target, 'PRINT_JOB_FAILED', { code: info.code });
    await this.notify(target.branchId, {
      title: 'Comanda sin imprimir',
      body: `${info.displayNumber ?? 'Comanda'} no se pudo imprimir en ${info.printerName}.`,
      data: { type: 'PRINT_JOB_FAILED', jobId: target.entityId },
    });
  }

  async printerOffline(
    target: AlertTarget,
    info: { printerName: string; lastError: string | null },
  ): Promise<boolean> {
    const last = this.lastPrinterAlert.get(target.entityId) ?? 0;

    if (Date.now() - last < this.config.alertCooldownMs) {
      return false;
    }

    this.lastPrinterAlert.set(target.entityId, Date.now());
    await this.record(target, 'PRINTER_OFFLINE', {
      lastError: info.lastError,
    });
    await this.notify(target.branchId, {
      title: 'Impresora sin conexion',
      body: `${info.printerName} sin conexion. Las comandas siguen en pantalla.`,
      data: { type: 'PRINTER_OFFLINE', printerId: target.entityId },
    });

    return true;
  }

  private async record(
    target: AlertTarget,
    action: string,
    after: Record<string, string | null>,
  ): Promise<void> {
    try {
      await this.audit.record(null, {
        restaurantId: target.restaurantId,
        branchId: target.branchId,
        actorStaffUserId: null,
        actorRole: null,
        action,
        entityType: target.entityType,
        entityId: target.entityId,
        after,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo auditar ${action}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  private async notify(
    branchId: string,
    payload: { title: string; body: string; data: Record<string, string> },
  ): Promise<void> {
    try {
      await this.push.notifyBranchRoles(
        branchId,
        [Role.ADMIN, Role.SUPERVISOR],
        payload,
      );
    } catch (error) {
      this.logger.error(
        `No se pudo enviar el aviso de impresion: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}
