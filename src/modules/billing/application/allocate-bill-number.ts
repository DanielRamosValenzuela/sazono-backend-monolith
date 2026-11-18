import type { Prisma } from '@prisma/client';

export async function allocateBillNumber(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  branchId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ bill_sequence: number }[]>`
    UPDATE "branches"
    SET "bill_sequence" = "bill_sequence" + 1
    WHERE "id" = ${branchId}::uuid
    RETURNING "bill_sequence"`;

  if (rows.length === 0) {
    throw new Error(
      `Branch ${branchId} not found while allocating bill number.`,
    );
  }

  return Number(rows[0].bill_sequence);
}
