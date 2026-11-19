import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

export const CREDIT_NOTE_STATUS_ISSUED = 'ISSUED';

@Injectable()
export class RefundCreditNoteSync {
  constructor(private readonly prisma: PrismaService) {}

  async markIssued(
    refundId: string,
    folio: number | null,
    client: Pick<Prisma.TransactionClient, 'refund'> = this.prisma,
  ): Promise<void> {
    await client.refund.updateMany({
      where: { id: refundId },
      data: {
        creditNoteStatus: CREDIT_NOTE_STATUS_ISSUED,
        creditNoteFolio: folio === null ? null : String(folio),
      },
    });
  }
}
