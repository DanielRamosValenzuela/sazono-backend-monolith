import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { buildVersionedControllerPath } from '../../../../common/http/api-version';
import { CurrentAuthUser } from '../../../auth/decorators/current-auth-user.decorator';
import { RequireProfileType } from '../../../auth/decorators/require-profile-type.decorator';
import { LoginProfileType } from '../../../auth/dto/login.dto';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ProfileTypeGuard } from '../../../auth/guards/profile-type.guard';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import { CreateStaffUserService } from '../../application/create-staff-user.service';
import { ListStaffUsersService } from '../../application/list-staff-users.service';
import { CreateStaffUserDto, StaffUserResponseDto } from './dto/staff.dto';

@ApiTags('staff')
@ApiBearerAuth()
@Controller(buildVersionedControllerPath('staff'))
export class StaffController {
  constructor(
    private readonly createStaffUserService: CreateStaffUserService,
    private readonly listStaffUsersService: ListStaffUsersService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Lista los usuarios internos del restaurante autenticado con sus roles activos por sucursal.',
  })
  findAll(
    @CurrentAuthUser() authUser: JwtPayload,
  ): Promise<StaffUserResponseDto[]> {
    return this.listStaffUsersService.execute(authUser);
  }

  @Post()
  @UseGuards(JwtAuthGuard, ProfileTypeGuard)
  @RequireProfileType(LoginProfileType.STAFF)
  @ApiOperation({
    summary:
      'Crea o vincula un usuario interno y le asigna roles activos por sucursal.',
  })
  create(
    @CurrentAuthUser() authUser: JwtPayload,
    @Body() dto: CreateStaffUserDto,
  ): Promise<StaffUserResponseDto> {
    return this.createStaffUserService.execute(authUser, dto);
  }
}
