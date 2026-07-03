import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, StaffUserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

class StaffBranchRoleInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  @IsEnum(Role)
  role!: Role;
}

export class CreateStaffUserDto {
  @ApiProperty({ example: 'ana@sazonodemo.cl' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    example: 'Temporal123!',
    description:
      'Opcional si el email ya existe en la identidad base compartida. Obligatorio para nuevas identidades.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({ example: 'Ana' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Diaz' })
  @IsString()
  lastName!: string;

  @ApiProperty({ type: [StaffBranchRoleInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StaffBranchRoleInputDto)
  branchRoles!: StaffBranchRoleInputDto[];
}

class StaffBranchRoleResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  branchName!: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role!: Role;
}

export class StaffUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  staffUserId!: string;

  @ApiProperty({ format: 'uuid' })
  authUserId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ nullable: true, required: false })
  email!: string | null;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: StaffUserStatus, enumName: 'StaffUserStatus' })
  status!: StaffUserStatus;

  @ApiProperty({ type: [StaffBranchRoleResponseDto] })
  branchRoles!: StaffBranchRoleResponseDto[];
}
