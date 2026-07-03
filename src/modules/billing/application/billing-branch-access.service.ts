import { ForbiddenException, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginProfileType } from '../../auth/dto/login.dto';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';

export type BillingBranchAccessContext = {
  staffUserId: string;
  restaurantId: string;
  branchId: string;
  roles: Role[];
};

@Injectable()
export class BillingBranchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureAccess(
    authUser: JwtPayload,
    branchId: string,
    allowedRoles: Role[],
  ): Promise<BillingBranchAccessContext> {
    if (
      authUser.profileType !== LoginProfileType.STAFF ||
      !authUser.restaurantId
    ) {
      throw new ForbiddenException(
        'Solo un staff autenticado puede operar sobre el modulo billing.',
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

    const roles = staffUser.branchRoles.map((branchRole) => branchRole.role);

    if (!roles.some((role) => allowedRoles.includes(role))) {
      throw new ForbiddenException(
        'No tienes permisos suficientes sobre esta sucursal.',
      );
    }

    return {
      staffUserId: staffUser.id,
      restaurantId: staffUser.restaurantId,
      branchId,
      roles,
    };
  }
}
