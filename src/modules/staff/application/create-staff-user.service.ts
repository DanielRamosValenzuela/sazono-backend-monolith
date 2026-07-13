import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { BranchRoleStatus, Role, StaffUserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BranchAccessService } from '../../../common/branch-access/branch-access.service';
import { AUTH_PROVIDER } from '../../auth/application/ports/auth-provider.port';
import type { AuthProvider } from '../../auth/application/ports/auth-provider.port';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import type {
  CreateStaffUserDto,
  StaffUserResponseDto,
} from '../presentation/http/dto/staff.dto';

type BranchRecord = {
  id: string;
  name: string;
};

@Injectable()
export class CreateStaffUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccessService: BranchAccessService,
    @Inject(AUTH_PROVIDER)
    private readonly authProvider: AuthProvider,
  ) {}

  async execute(
    authUser: JwtPayload,
    dto: CreateStaffUserDto,
  ): Promise<StaffUserResponseDto> {
    const context = await this.branchAccessService.getStaffContext(authUser);

    if (context.adminBranchIds.size === 0) {
      throw new ForbiddenException(
        'Debes tener al menos un rol ADMIN para administrar usuarios internos.',
      );
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const uniqueAssignments = this.getUniqueAssignments(dto.branchRoles);
    const branchIds = [
      ...new Set(uniqueAssignments.map((item) => item.branchId)),
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
        name: true,
      },
    });

    if (branches.length !== branchIds.length) {
      throw new BadRequestException(
        'Una o mas sucursales no existen o no pertenecen al restaurante autenticado.',
      );
    }

    let authIdentity = await this.authProvider.findUserByEmail(normalizedEmail);
    let createdAuthUserId: string | null = null;

    if (!authIdentity) {
      if (!dto.password) {
        throw new BadRequestException(
          'Debes enviar password cuando el email aun no existe en la identidad base.',
        );
      }

      authIdentity = await this.authProvider.createUser({
        email: normalizedEmail,
        password: dto.password,
        emailConfirmed: true,
        userMetadata: {
          first_name: dto.firstName,
          last_name: dto.lastName,
          kind: 'staff_user',
        },
      });
      createdAuthUserId = authIdentity.authUserId;
    }

    const existingStaffUser = await this.prisma.staffUser.findFirst({
      where: {
        authUserId: authIdentity.authUserId,
        restaurantId: context.restaurantId,
      },
    });

    if (existingStaffUser) {
      throw new ConflictException(
        'La identidad base ya tiene un perfil staff en este restaurante.',
      );
    }

    try {
      const createdStaffUser = await this.prisma.$transaction(async (tx) => {
        const staffUser = await tx.staffUser.create({
          data: {
            authUserId: authIdentity.authUserId,
            restaurantId: context.restaurantId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            status: StaffUserStatus.ACTIVE,
          },
        });

        await tx.staffUserBranchRole.createMany({
          data: uniqueAssignments.map((assignment) => ({
            staffUserId: staffUser.id,
            branchId: assignment.branchId,
            role: assignment.role,
            status: BranchRoleStatus.ACTIVE,
          })),
        });

        return tx.staffUser.findUniqueOrThrow({
          where: {
            id: staffUser.id,
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

      return this.toResponse(createdStaffUser, normalizedEmail);
    } catch (error) {
      if (createdAuthUserId) {
        await this.authProvider.deleteUser(createdAuthUserId);
      }

      throw error;
    }
  }

  private getUniqueAssignments(
    branchRoles: CreateStaffUserDto['branchRoles'],
  ): CreateStaffUserDto['branchRoles'] {
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

  private toResponse(
    staffUser: {
      id: string;
      authUserId: string;
      restaurantId: string;
      firstName: string;
      lastName: string;
      status: StaffUserStatus;
      branchRoles: Array<{
        branchId: string;
        role: Role;
        branch: BranchRecord;
      }>;
    },
    email: string,
  ): StaffUserResponseDto {
    return {
      staffUserId: staffUser.id,
      authUserId: staffUser.authUserId,
      restaurantId: staffUser.restaurantId,
      email,
      firstName: staffUser.firstName,
      lastName: staffUser.lastName,
      status: staffUser.status,
      branchRoles: staffUser.branchRoles.map((branchRole) => ({
        branchId: branchRole.branchId,
        branchName: branchRole.branch.name,
        role: branchRole.role,
      })),
    };
  }
}
