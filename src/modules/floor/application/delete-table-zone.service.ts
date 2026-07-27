import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';

@Injectable()
export class DeleteTableZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(authUser: JwtPayload, zoneId: string): Promise<void> {
    const zone = await this.prisma.tableZone.findUnique({
      where: {
        id: zoneId,
      },
    });

    if (!zone) {
      throw new BadRequestException('La zona indicada no existe.');
    }

    await this.branchAccessService.ensureAccess(authUser, zone.branchId, [
      Role.ADMIN,
      Role.SUPERVISOR,
    ]);

    await this.prisma.tableZone.delete({
      where: {
        id: zoneId,
      },
    });
  }
}
