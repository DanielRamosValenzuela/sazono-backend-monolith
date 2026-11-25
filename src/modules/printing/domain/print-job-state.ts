import { PrintJobStatus } from '@prisma/client';
import { computePrintNextAttemptAt } from './retry-policy';

const TRANSITIONS: Record<PrintJobStatus, PrintJobStatus[]> = {
  [PrintJobStatus.PENDING]: [PrintJobStatus.CLAIMED, PrintJobStatus.CANCELLED],
  [PrintJobStatus.CLAIMED]: [
    PrintJobStatus.PRINTED,
    PrintJobStatus.PENDING,
    PrintJobStatus.FAILED,
    PrintJobStatus.CANCELLED,
    PrintJobStatus.CLAIMED,
  ],
  [PrintJobStatus.PRINTED]: [],
  [PrintJobStatus.FAILED]: [PrintJobStatus.PENDING, PrintJobStatus.PRINTED],
  [PrintJobStatus.CANCELLED]: [],
};

export function canTransitionPrintJob(
  from: PrintJobStatus,
  to: PrintJobStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export type FailureDecision =
  | { status: 'PENDING'; nextAttemptAt: Date }
  | { status: 'FAILED'; nextAttemptAt: null };

export function decideFailure(input: {
  retryable: boolean;
  attempts: number;
  maxAttempts: number;
  now: Date;
  baseMs: number;
}): FailureDecision {
  if (!input.retryable) {
    return { status: 'FAILED', nextAttemptAt: null };
  }

  const next = computePrintNextAttemptAt(
    input.now,
    input.attempts,
    input.baseMs,
    input.maxAttempts,
  );

  return next
    ? { status: 'PENDING', nextAttemptAt: next }
    : { status: 'FAILED', nextAttemptAt: null };
}

export const MANUAL_RETRY_MARK = 'MANUAL_RETRY';
