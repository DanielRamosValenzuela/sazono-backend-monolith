import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeviceProtocolService } from './application/device-protocol.service';
import { bindTicketCounterClient } from './application/enqueue-station-ticket-print';
import { PrintAlertsService } from './application/print-alerts.service';
import { PrintDevicesService } from './application/print-devices.service';
import { PrintJobsService } from './application/print-jobs.service';
import { PrintQueueService } from './application/print-queue.service';
import { PrintReconcilerService } from './application/print-reconciler.service';
import { PrintWakeService } from './application/print-wake.service';
import { PrintWorkerService } from './application/print-worker.service';
import { PrintersService } from './application/printers.service';
import { PrintingConfigService } from './application/printing-config.service';
import { ReprintService } from './application/reprint.service';
import { PrintingScheduler } from './infrastructure/printing.scheduler';
import { SimulatedTransport } from './infrastructure/simulated.transport';
import { Tcp9100Transport } from './infrastructure/tcp9100.transport';
import { DeviceAuthGuard } from './presentation/http/device-auth.guard';
import { DevicePrintController } from './presentation/http/device-print.controller';
import { PrintingAdminController } from './presentation/http/printing-admin.controller';

@Module({
  imports: [AuditModule, AuthModule, NotificationsModule],
  controllers: [PrintingAdminController, DevicePrintController],
  providers: [
    PrintingConfigService,
    PrintAlertsService,
    PrintWakeService,
    PrintersService,
    PrintJobsService,
    PrintDevicesService,
    DeviceProtocolService,
    DeviceAuthGuard,
    PrintQueueService,
    SimulatedTransport,
    Tcp9100Transport,
    PrintWorkerService,
    PrintReconcilerService,
    ReprintService,
    PrintingScheduler,
  ],
  exports: [
    PrintingConfigService,
    PrintQueueService,
    PrintWorkerService,
    ReprintService,
  ],
})
export class PrintingModule {
  constructor(prisma: PrismaService) {
    bindTicketCounterClient(prisma.autocommit);
  }
}
