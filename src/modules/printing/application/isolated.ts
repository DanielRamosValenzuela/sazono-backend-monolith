import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

const logger = new Logger('PrintingHooks');

export async function runIsolated(
  tx: Prisma.TransactionClient,
  label: string,
  work: () => Promise<void>,
): Promise<void> {
  let opened = false;

  try {
    await tx.$executeRaw`SAVEPOINT print_hook`;
    opened = true;
    await work();
    await tx.$executeRaw`RELEASE SAVEPOINT print_hook`;
  } catch (error) {
    logger.warn(
      `${label} fallo y se omitio sin afectar el pedido: ${
        error instanceof Error ? error.message : 'error desconocido'
      }`,
    );

    if (opened) {
      try {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT print_hook`;
        await tx.$executeRaw`RELEASE SAVEPOINT print_hook`;
      } catch (rollbackError) {
        logger.error(
          `No se pudo revertir el savepoint de impresion: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : 'error desconocido'
          }`,
        );
      }
    }
  }
}
