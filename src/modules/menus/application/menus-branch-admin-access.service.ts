import { ForbiddenException, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

export type MenusBranchAdminContext = {
  staffUserId: string;
  restaurantId: string;
  branchId: string;
};

@Injectable()
export class MenusBranchAdminAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureAdminAccess(
    authUser: JwtPayload,
    branchId: string,
  ): Promise<MenusBranchAdminContext> {
    if (
      authUser.profileType !== LoginProfileType.STAFF ||
      !authUser.restaurantId
    ) {
      throw new ForbiddenException(
        'Solo un staff autenticado puede administrar cartas.',
      );
    }

    const staffUser = await this.prisma.staffUser.findFirst({
      where: {
        id: authUser.profileId,
        restaurantId: authUser.restaurantId,
        status: StaffUserStatus.ACTIVE,
      },
      include: {
        branchRoles: {
          where: {
            branchId,
            role: Role.ADMIN,
            status: BranchRoleStatus.ACTIVE,
          },
          select: {
            role: true,
          },
        },
      },
    });

    if (!staffUser) {
      throw new ForbiddenException(
        'El perfil staff autenticado no esta disponible para este restaurante.',
      );
    }

    if (staffUser.branchRoles.length === 0) {
      throw new ForbiddenException(
        'Debes tener rol ADMIN en la sucursal para administrar la carta.',
      );
    }

    return {
      staffUserId: staffUser.id,
      restaurantId: staffUser.restaurantId,
      branchId,
    };
  }
}
