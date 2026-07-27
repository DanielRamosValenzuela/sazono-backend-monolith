import { Injectable, NotFoundException } from '@nestjs/common';
import { TableStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { QrOrderPaymentStatusResponseDto } from '../presentation/http/dto/payments.dto';

@Injectable()
export class GetQrOrderPaymentStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    qrToken: string,
    orderId: string,
  ): Promise<QrOrderPaymentStatusResponseDto> {
    const table = await this.prisma.table.findUnique({
      where: {
        qrToken,
      },
    });

    if (!table || table.status === TableStatus.DISABLED) {
      throw new NotFoundException('El QR indicado no esta disponible.');
    }

    const order = await this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
      include: {
        tableSession: true,
      },
    });

    if (!order || order.tableSession.tableId !== table.id) {
      throw new NotFoundException(
        'La orden indicada no pertenece a la mesa del QR.',
      );
    }

    const latestAttempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        orderId: order.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        payment: true,
      },
    });

    return {
      orderId: order.id,
      orderStatus: order.status,
      attemptStatus: latestAttempt?.status ?? null,
      paymentStatus: latestAttempt?.payment?.status ?? null,
      providerReference: latestAttempt?.providerReference ?? null,
      failureReason: latestAttempt?.failureReason ?? null,
      updatedAt: (latestAttempt?.updatedAt ?? order.updatedAt).toISOString(),
    };
  }
}
