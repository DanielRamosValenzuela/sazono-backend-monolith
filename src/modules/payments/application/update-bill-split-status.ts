import type { Prisma } from '@prisma/client';
import { BillSplitParticipantStatus, BillSplitStatus } from '@prisma/client';
export async function updateBillSplitStatus(
  tx: Prisma.TransactionClient,
  billSplitId: string,
): Promise<void> {
  const participants = await tx.billSplitParticipant.findMany({
    where: {
      billSplitId,
    },
    select: {
      status: true,
    },
  });

  if (participants.length === 0) {
    return;
  }

  const allPaid = participants.every(
    (participant) => participant.status === BillSplitParticipantStatus.PAID,
  );
  const anyPaid = participants.some(
    (participant) =>
      participant.status === BillSplitParticipantStatus.PAID ||
      participant.status === BillSplitParticipantStatus.PARTIALLY_PAID,
  );

  const status = allPaid
    ? BillSplitStatus.PAID
    : anyPaid
      ? BillSplitStatus.PARTIALLY_PAID
      : BillSplitStatus.OPEN;

  await tx.billSplit.update({
    where: {
      id: billSplitId,
    },
    data: {
      status,
    },
  });
}
