import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

const POOL_IDLE_TIMEOUT_MS = 300_000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly configService: ConfigService) {
    const nodeEnv = configService.get<string>('NODE_ENV');
    const datasourceUrl = configService.get<string>('DATABASE_URL');
    const adapter = datasourceUrl
      ? new PrismaPg({
          connectionString: datasourceUrl,
          idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
          keepAlive: true,
        })
      : undefined;

    const log: Prisma.LogLevel[] =
      nodeEnv === 'development' ? ['warn', 'error'] : ['error'];

    super({
      ...(adapter ? { adapter } : {}),
      log,
      transactionOptions: {
        maxWait: 5000,
        timeout: 15000,
      },
    });
  }

  async onModuleInit() {
    if (this.configService.get<boolean>('PRISMA_CONNECT_ON_STARTUP')) {
      await this.$connect();
    }

    void this.$queryRaw`SELECT 1`.catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
