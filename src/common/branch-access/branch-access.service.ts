import { ForbiddenException, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginProfileType } from '../../modules/auth/dto/login.dto';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

export type BranchAccessContext = {
  staffUserId: string;
  restaurantId: string;
  branchId: string;
  roles: Role[];
};

export type StaffContext = {
  staffUserId: string;
  restaurantId: string;
  memberBranchIds: Set<string>;
  adminBranchIds: Set<string>;
};

@Injectable()
export class BranchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureAccess(
    authUser: JwtPayload,
    branchId: string,
    allowedRoles: Role[],
  ): Promise<BranchAccessContext> {
    if (
      authUser.profileType !== LoginProfileType.STAFF ||
      !authUser.restaurantId
    ) {
      throw new ForbiddenException(
        'Solo un staff autenticado puede operar sobre esta sucursal.',
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

  async getStaffContext(authUser: JwtPayload): Promise<StaffContext> {
    if (
      authUser.profileType !== LoginProfileType.STAFF ||
      !authUser.restaurantId
    ) {
      throw new ForbiddenException(
        'Solo un staff autenticado puede realizar esta accion.',
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
            status: BranchRoleStatus.ACTIVE,
          },
          select: {
            branchId: true,
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

    const memberBranchIds = new Set(
      staffUser.branchRoles.map((branchRole) => branchRole.branchId),
    );
    const adminBranchIds = new Set(
      staffUser.branchRoles
        .filter((branchRole) => branchRole.role === Role.ADMIN)
        .map((branchRole) => branchRole.branchId),
    );

    return {
      staffUserId: staffUser.id,
      restaurantId: staffUser.restaurantId,
      memberBranchIds,
      adminBranchIds,
    };
  }
}
