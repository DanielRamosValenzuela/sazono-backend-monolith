import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BranchRoleStatus,
  Prisma,
  Role,
  StaffUserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AUTH_PROVIDER } from '../../auth/application/ports/auth-provider.port';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { StaffAdminAccessService } from './staff-admin-access.service';
import type {
  StaffUserResponseDto,
  UpdateStaffUserDto,
} from '../presentation/http/dto/staff.dto';

type BranchRoleAssignment = {
  branchId: string;
  role: Role;
};

@Injectable()
export class UpdateStaffUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAdminAccessService: StaffAdminAccessService,
    @Inject(AUTH_PROVIDER)
    private readonly authProvider: AuthProvider,
  ) {}

  async execute(
    authUser: JwtPayload,
    staffUserId: string,
    dto: UpdateStaffUserDto,
  ): Promise<StaffUserResponseDto> {
    const context =
      await this.staffAdminAccessService.getAdminContext(authUser);

    const hasChanges =
      dto.firstName !== undefined ||
      dto.lastName !== undefined ||
      dto.status !== undefined ||
      dto.branchRoles !== undefined;

    if (!hasChanges) {
      throw new BadRequestException(
        'Debes enviar al menos un campo para actualizar.',
      );
    }

    const targetStaffUser = await this.prisma.staffUser.findFirst({
      where: {
        id: staffUserId,
        restaurantId: context.restaurantId,
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

    if (!targetStaffUser) {
      throw new NotFoundException(
        'El usuario staff no existe en el restaurante autenticado.',
      );
    }

    const isSelf = targetStaffUser.id === context.staffUserId;

    if (isSelf && dto.status === StaffUserStatus.DISABLED) {
      throw new BadRequestException(
        'No puedes desactivar tu propia cuenta staff.',
      );
    }

    const uniqueAssignments = dto.branchRoles
      ? this.getUniqueAssignments(dto.branchRoles)
      : undefined;

    if (uniqueAssignments) {
      await this.assertAssignableBranches(context, uniqueAssignments);

      if (
        isSelf &&
        !uniqueAssignments.some((assignment) => assignment.role === Role.ADMIN)
      ) {
        throw new BadRequestException(
          'No puedes quitarte tu ultimo rol ADMIN.',
        );
      }
    }

    await this.assertRestaurantKeepsActiveAdmin(
      context.restaurantId,
      targetStaffUser,
      dto,
      uniqueAssignments,
    );

    const updatedStaffUser = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.StaffUserUpdateInput = {};

      if (dto.firstName !== undefined) {
        data.firstName = dto.firstName;
      }

      if (dto.lastName !== undefined) {
        data.lastName = dto.lastName;
      }

      if (dto.status !== undefined) {
        data.status = dto.status;
      }

      if (Object.keys(data).length > 0) {
        await tx.staffUser.update({
          where: {
            id: targetStaffUser.id,
          },
          data,
        });
      }

      if (uniqueAssignments) {
        await tx.staffUserBranchRole.updateMany({
          where: {
            staffUserId: targetStaffUser.id,
          },
          data: {
            status: BranchRoleStatus.INACTIVE,
          },
        });

        for (const assignment of uniqueAssignments) {
          await tx.staffUserBranchRole.upsert({
            where: {
              staffUserId_branchId_role: {
                staffUserId: targetStaffUser.id,
                branchId: assignment.branchId,
                role: assignment.role,
              },
            },
            update: {
              status: BranchRoleStatus.ACTIVE,
            },
            create: {
              staffUserId: targetStaffUser.id,
              branchId: assignment.branchId,
              role: assignment.role,
              status: BranchRoleStatus.ACTIVE,
            },
          });
        }
      }

      return tx.staffUser.findUniqueOrThrow({
        where: {
          id: targetStaffUser.id,
        },
        include: {
          branchRoles: {
            where: {
              status: BranchRoleStatus.ACTIVE,
            },
            include: {
              branch: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });
    });

    const identity = await this.authProvider.getUserById(
      updatedStaffUser.authUserId,
    );

    return {
      staffUserId: updatedStaffUser.id,
      authUserId: updatedStaffUser.authUserId,
      restaurantId: updatedStaffUser.restaurantId,
      email: identity?.email ?? null,
      firstName: updatedStaffUser.firstName,
      lastName: updatedStaffUser.lastName,
      status: updatedStaffUser.status,
      branchRoles: updatedStaffUser.branchRoles.map((branchRole) => ({
        branchId: branchRole.branchId,
        branchName: branchRole.branch.name,
        role: branchRole.role,
      })),
    };
  }

  private async assertAssignableBranches(
    context: { restaurantId: string; adminBranchIds: Set<string> },
    assignments: BranchRoleAssignment[],
  ): Promise<void> {
    const branchIds = [
      ...new Set(assignments.map((assignment) => assignment.branchId)),
    ];

    for (const branchId of branchIds) {
      if (!context.adminBranchIds.has(branchId)) {
        throw new ForbiddenException(
          'Solo puedes asignar roles sobre sucursales donde seas ADMIN.',
        );
      }
    }

    const branches = await this.prisma.branch.findMany({
      where: {
        id: {
          in: branchIds,
        },
        restaurantId: context.restaurantId,
      },
      select: {
        id: true,
      },
    });

    if (branches.length !== branchIds.length) {
      throw new BadRequestException(
        'Una o mas sucursales no existen o no pertenecen al restaurante autenticado.',
      );
    }
  }

  private async assertRestaurantKeepsActiveAdmin(
    restaurantId: string,
    targetStaffUser: {
      id: string;
      status: StaffUserStatus;
      branchRoles: BranchRoleAssignment[];
    },
    dto: UpdateStaffUserDto,
    uniqueAssignments: BranchRoleAssignment[] | undefined,
  ): Promise<void> {
    const otherActiveAdmins = await this.prisma.staffUser.count({
      where: {
        restaurantId,
        id: {
          not: targetStaffUser.id,
        },
        status: StaffUserStatus.ACTIVE,
        branchRoles: {
          some: {
            role: Role.ADMIN,
            status: BranchRoleStatus.ACTIVE,
          },
        },
      },
    });

    if (otherActiveAdmins > 0) {
      return;
    }

    const nextStatus = dto.status ?? targetStaffUser.status;
    const nextRoles = uniqueAssignments ?? targetStaffUser.branchRoles;
    const remainsActiveAdmin =
      nextStatus === StaffUserStatus.ACTIVE &&
      nextRoles.some((branchRole) => branchRole.role === Role.ADMIN);

    if (!remainsActiveAdmin) {
      throw new ConflictException(
        'La operacion dejaria al restaurante sin ningun staff ACTIVE con rol ADMIN activo.',
      );
    }
  }

  private getUniqueAssignments(
    branchRoles: BranchRoleAssignment[],
  ): BranchRoleAssignment[] {
    const seen = new Set<string>();

    return branchRoles.filter((branchRole) => {
      const key = `${branchRole.branchId}:${branchRole.role}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }
}
