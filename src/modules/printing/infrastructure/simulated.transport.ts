import { Injectable } from '@nestjs/common';
import { PrinterTransport } from '@prisma/client';
import type {
  DeliverOutcome,
  PrintTransport,
} from '../application/ports/print-transport.port';

@Injectable()
export class SimulatedTransport implements PrintTransport {
  readonly kind = PrinterTransport.SIMULATED;

  deliver(): Promise<DeliverOutcome> {
    return Promise.resolve({ kind: 'OK' });
  }
}
