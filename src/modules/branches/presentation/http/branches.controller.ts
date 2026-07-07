import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { CreateBranchService } from '../../application/create-branch.service';
import { ListBranchesService } from '../../application/list-branches.service';
import { UpdateBranchService } from '../../application/update-branch.service';
import {
  CreateBranchDto,
  CreateBranchResponseDto,
} from './dto/create-branch.dto';
import { BranchResponseDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('branches')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('branches'))
export class BranchesController {
  constructor(
    private readonly createBranchService: CreateBranchService,
    private readonly listBranchesService: ListBranchesService,
    private readonly updateBranchService: UpdateBranchService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Lista las sucursales del restaurante autenticado segun los roles del staff.',
  })
  findAll(
    @CurrentAuthUser() authUser: JwtPayload,
  ): Promise<BranchResponseDto[]> {
    return this.listBranchesService.execute(authUser);
  }

  @Post()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Crea una sucursal para el restaurante autenticado y asigna ADMIN al creador.',
  })
  create(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: CreateBranchDto,
  ): Promise<CreateBranchResponseDto> {
    return this.createBranchService.execute(authUser, dto);
  }

  @Patch(':branchId')
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Actualiza parcialmente una sucursal y sus settings. Requiere rol ADMIN en la sucursal.',
  })
  update(
    @CurrentAuthUser() authUser: JwtPayload,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<BranchResponseDto> {
    return this.updateBranchService.execute(authUser, branchId, dto);
  }
}
