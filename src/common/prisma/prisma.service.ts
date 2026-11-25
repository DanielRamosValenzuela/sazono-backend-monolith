import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

const POOL_IDLE_TIMEOUT_MS = 300_000;
const AUTOCOMMIT_POOL_MAX = 3;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  readonly autocommit: PrismaClient;

  constructor(private readonly configService: ConfigService) {
    const nodeEnv = configService.get<string>('NODE_ENV');
    const datasourceUrl = configService.get<string>('DATABASE_URL');
    const poolMax = configService.get<number>('DB_POOL_MAX') ?? 10;
    const txMaxWait = configService.get<number>('DB_TX_MAX_WAIT_MS') ?? 10000;
    const txTimeout = configService.get<number>('DB_TX_TIMEOUT_MS') ?? 15000;
    const buildAdapter = (max: number, sideCar = false) =>
      datasourceUrl
        ? new PrismaPg({
            connectionString: datasourceUrl,
            idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
            keepAlive: true,
            max,
            ...(sideCar ? { connectionTimeoutMillis: 5000 } : {}),
          })
        : undefined;
    const adapter = buildAdapter(poolMax);

    const log: Prisma.LogLevel[] =
      nodeEnv === 'development' ? ['warn', 'error'] : ['error'];

    super({
      ...(adapter ? { adapter } : {}),
      log,
      transactionOptions: {
        maxWait: txMaxWait,
        timeout: txTimeout,
      },
    });

    const sideAdapter = buildAdapter(AUTOCOMMIT_POOL_MAX, true);

    this.autocommit = new PrismaClient({
      ...(sideAdapter ? { adapter: sideAdapter } : {}),
      log,
    });
  }

  async onModuleInit() {
    if (this.configService.get<boolean>('PRISMA_CONNECT_ON_STARTUP')) {
      await this.$connect();
    }

    void this.$queryRaw`SELECT 1`.catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.autocommit.$disconnect();
    await this.$disconnect();
  }
}
