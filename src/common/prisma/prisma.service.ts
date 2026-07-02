import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

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
        })
      : undefined;

    const log: Prisma.LogLevel[] =
      nodeEnv === 'development' ? ['warn', 'error'] : ['error'];

    super({
      ...(adapter ? { adapter } : {}),
      log,
    });
  }

  async onModuleInit() {
    if (this.configService.get<boolean>('PRISMA_CONNECT_ON_STARTUP')) {
      await this.$connect();
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
