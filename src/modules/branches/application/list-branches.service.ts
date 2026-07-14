import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { mapBranchToResponse } from './branch-mapper';
import type { BranchResponseDto } from '../presentation/http/dto/branch.dto';

@Injectable()
export class ListBranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
  ) {}

  async execute(authUser: JwtPayload): Promise<BranchResponseDto[]> {
    const context = await this.branchAccessService.getStaffContext(authUser);

    const isRestaurantAdmin = context.adminBranchIds.size > 0;

    if (!isRestaurantAdmin && context.memberBranchIds.size === 0) {
      return [];
    }

    const branches = await this.prisma.branch.findMany({
      where: {
        restaurantId: context.restaurantId,
        ...(isRestaurantAdmin
          ? {}
          : {
              id: {
                in: [...context.memberBranchIds],
              },
            }),
      },
      include: {
        settings: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return branches.map((branch) => mapBranchToResponse(branch));
  }
}
