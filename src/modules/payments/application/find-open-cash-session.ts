import { Prisma } from '@prisma/client';

export async function findOpenCashSessionId(
  tx: Prisma.TransactionClient,
  branchId: string,
  staffUserId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id::text AS id
      FROM cash_sessions
      WHERE branch_id = ${branchId}::uuid
        AND cashier_staff_user_id = ${staffUserId}::uuid
        AND status = 'OPEN'
      FOR SHARE
    `,
  );

  return rows[0]?.id ?? null;
}
