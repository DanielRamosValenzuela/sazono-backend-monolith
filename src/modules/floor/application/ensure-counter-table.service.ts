import { Injectable } from '@nestjs/common';
import { Prisma, TableStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  COUNTER_TABLE_CODE,
  COUNTER_TABLE_NAME,
} from '../domain/counter-table';

@Injectable()
export class EnsureCounterTableService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(branchId: string) {
    const existing = await this.find(branchId);

    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.table.create({
        data: {
          branchId,
          code: COUNTER_TABLE_CODE,
          name: COUNTER_TABLE_NAME,
          isVirtual: true,
          status: TableStatus.DISABLED,
          qrToken: randomUUID(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.find(branchId);

        if (raced) {
          return raced;
        }
      }
      throw error;
    }
  }

  private find(branchId: string) {
    return this.prisma.table.findFirst({
      where: { branchId, isVirtual: true },
    });
  }
}
