import { ApiProperty } from '@nestjs/swagger';
import { LoginProfileType } from './login.dto';

export class StaffBranchRoleDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty()
  role!: string;
}

export class AuthenticatedProfileDto {
  @ApiProperty({ format: 'uuid' })
  authIdentityId!: string;

  @ApiProperty({ enum: LoginProfileType })
  profileType!: LoginProfileType;

  @ApiProperty({ format: 'uuid' })
  profileId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ format: 'uuid', required: false, nullable: true })
  restaurantId!: string | null;

  @ApiProperty({ type: [StaffBranchRoleDto] })
  branchRoles!: StaffBranchRoleDto[];
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ example: '15m' })
  expiresIn!: string;

  @ApiProperty({ type: AuthenticatedProfileDto })
  user!: AuthenticatedProfileDto;
}
