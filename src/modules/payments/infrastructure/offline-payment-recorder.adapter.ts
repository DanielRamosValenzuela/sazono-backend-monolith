import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  OfflinePaymentRecord,
  OfflinePaymentRecordInput,
  OfflinePaymentRecorderPort,
} from '../application/ports/offline-payment-recorder.port';
@Injectable()
export class OfflinePaymentRecorderAdapter implements OfflinePaymentRecorderPort {
  readonly providerName = 'MANUAL';

  record(input: OfflinePaymentRecordInput): Promise<OfflinePaymentRecord> {
    void input;

    return Promise.resolve({
      providerReference: `manual-${randomUUID()}`,
    });
  }
}
