import { Prisma } from '@prisma/client';

export async function lockBill(
  tx: Prisma.TransactionClient,
  billId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT 1 FROM bills WHERE id = ${billId}::uuid FOR UPDATE`,
  );
}
