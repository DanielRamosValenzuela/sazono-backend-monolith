import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  TaxDocumentStatus,
  TaxDocumentType,
  type TaxDocument,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

export const CREDIT_NOTE_REFERENCE_CODE_CORRECT_AMOUNT = 3;

type Client = Pick<Prisma.TransactionClient, 'refund' | 'taxDocument'>;

@Injectable()
export class CreatePendingCreditNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    refundId: string,
    client: Client = this.prisma,
  ): Promise<TaxDocument> {
    const existing = await client.taxDocument.findUnique({
      where: { refundId },
    });

    if (existing) {
      return existing;
    }

    const refund = await client.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        restaurantId: true,
        branchId: true,
        billId: true,
        paymentId: true,
        amount: true,
        tipAmount: true,
        netAmount: true,
        vatAmount: true,
        reasonText: true,
      },
    });

    if (!refund) {
      throw new NotFoundException('El reembolso no existe.');
    }

    const boleta = await client.taxDocument.findFirst({
      where: {
        billId: refund.billId,
        type: {
          in: [TaxDocumentType.BOLETA_AFECTA, TaxDocumentType.BOLETA_EXENTA],
        },
        status: TaxDocumentStatus.ISSUED,
      },
      orderBy: { issuedAt: 'desc' },
      select: { id: true },
    });

    return client.taxDocument.create({
      data: {
        restaurantId: refund.restaurantId,
        branchId: refund.branchId,
        billId: refund.billId,
        paymentId: refund.paymentId,
        refundId: refund.id,
        type: TaxDocumentType.NOTA_CREDITO,
        status: TaxDocumentStatus.PENDING,
        netAmount: refund.netAmount,
        exemptAmount: new Prisma.Decimal(0),
        vatAmount: refund.vatAmount,
        tipAmount: refund.tipAmount,
        totalAmount: refund.amount,
        referenceDocumentId: boleta?.id ?? null,
        referenceCode: boleta
          ? CREDIT_NOTE_REFERENCE_CODE_CORRECT_AMOUNT
          : null,
        reason: refund.reasonText,
      },
    });
  }
}
