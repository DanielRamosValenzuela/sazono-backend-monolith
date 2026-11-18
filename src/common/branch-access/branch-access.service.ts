import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { CACHE_STORE } from '../cache/cache-store';
import type { CacheStore } from '../cache/cache-store';
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

type CachedStaffAccess = {
  staffUserId: string;
  restaurantId: string;
  branchRoles: Array<{ branchId: string; role: Role }>;
};

export const STAFF_ACCESS_CACHE_TTL_MS = 20_000;

const staffAccessCacheKey = (staffUserId: string) =>
  `staff-access:${staffUserId}`;

@Injectable()
export class BranchAccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_STORE) private readonly cache: CacheStore,
  ) {}

  invalidateStaff(staffUserId: string): Promise<void> {
    return this.cache.delete(staffAccessCacheKey(staffUserId));
  }

  private async findActiveStaffAccess(
    staffUserId: string,
    restaurantId: string,
    skipCache: boolean,
  ): Promise<{ access: CachedStaffAccess | null; fromCache: boolean }> {
    const key = staffAccessCacheKey(staffUserId);

    if (!skipCache) {
      const cached = await this.cache.get<CachedStaffAccess>(key);

      if (cached && cached.restaurantId === restaurantId) {
        return { access: cached, fromCache: true };
      }
    }

    const staffUser = await this.prisma.staffUser.findFirst({
      where: {
        id: staffUserId,
        restaurantId,
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
      await this.cache.delete(key);
      return { access: null, fromCache: false };
    }

    const access: CachedStaffAccess = {
      staffUserId: staffUser.id,
      restaurantId: staffUser.restaurantId,
      branchRoles: staffUser.branchRoles,
    };

    await this.cache.set(key, access, STAFF_ACCESS_CACHE_TTL_MS);

    return { access, fromCache: false };
  }

  async ensureAccess(
    authUser: JwtPayload,
    branchId: string,
    allowedRoles: Role[],
    options?: { fresh?: boolean },
  ): Promise<BranchAccessContext> {
    if (
      authUser.profileType !== LoginProfileType.STAFF ||
      !authUser.restaurantId
    ) {
      throw new ForbiddenException(
        'Solo un staff autenticado puede operar sobre esta sucursal.',
      );
    }

    const rolesOnBranch = (access: CachedStaffAccess | null) =>
      (access?.branchRoles ?? [])
        .filter((branchRole) => branchRole.branchId === branchId)
        .map((branchRole) => branchRole.role);

    const firstLookup = await this.findActiveStaffAccess(
      authUser.profileId,
      authUser.restaurantId,
      options?.fresh === true,
    );
    let staffUser = firstLookup.access;
    let roles = rolesOnBranch(staffUser);

    if (
      firstLookup.fromCache &&
      !roles.some((role) => allowedRoles.includes(role))
    ) {
      staffUser = (
        await this.findActiveStaffAccess(
          authUser.profileId,
          authUser.restaurantId,
          true,
        )
      ).access;
      roles = rolesOnBranch(staffUser);
    }

    if (!staffUser) {
      throw new ForbiddenException(
        'El perfil staff autenticado no esta disponible para este restaurante.',
      );
    }

    if (!roles.some((role) => allowedRoles.includes(role))) {
      throw new ForbiddenException(
        'No tienes permisos suficientes sobre esta sucursal.',
      );
    }

    return {
      staffUserId: staffUser.staffUserId,
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

    const { access } = await this.findActiveStaffAccess(
      authUser.profileId,
      authUser.restaurantId,
      false,
    );

    if (!access) {
      throw new ForbiddenException(
        'El perfil staff autenticado no esta disponible para este restaurante.',
      );
    }

    const memberBranchIds = new Set(
      access.branchRoles.map((branchRole) => branchRole.branchId),
    );
    const adminBranchIds = new Set(
      access.branchRoles
        .filter((branchRole) => branchRole.role === Role.ADMIN)
        .map((branchRole) => branchRole.branchId),
    );

    return {
      staffUserId: access.staffUserId,
      restaurantId: access.restaurantId,
      memberBranchIds,
      adminBranchIds,
    };
  }
}
