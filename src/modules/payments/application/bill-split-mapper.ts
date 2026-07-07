import {
  BillSplitMode,
  BillSplitParticipantStatus,
  BillSplitStatus,
  Prisma,
} from '@prisma/client';
import type { BillSplitResponseDto } from '../presentation/http/dto/payments.dto';

export type BillSplitWithParticipants = {
  id: string;
  billId: string;
  splitMode: BillSplitMode;
  status: BillSplitStatus;
  participants: Array<{
    id: string;
    participantToken: string;
    displayName: string | null;
    allocatedAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    status: BillSplitParticipantStatus;
  }>;
};

export const BILL_SPLIT_INCLUDE = {
  participants: {
    orderBy: [{ createdAt: 'asc' as const }],
  },
} satisfies Prisma.BillSplitInclude;

export const mapBillSplit = (
  split: BillSplitWithParticipants,
): BillSplitResponseDto => ({
  billSplitId: split.id,
  billId: split.billId,
  splitMode: split.splitMode,
  status: split.status,
  participants: split.participants.map((participant) => ({
    participantId: participant.id,
    participantToken: participant.participantToken,
    displayName: participant.displayName,
    allocatedAmount: participant.allocatedAmount.toString(),
    paidAmount: participant.paidAmount.toString(),
    status: participant.status,
  })),
});
