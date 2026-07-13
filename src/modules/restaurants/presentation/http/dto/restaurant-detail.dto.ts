import { ApiProperty } from '@nestjs/swagger';
import {
  BranchStatus,
  RestaurantStatus,
  Role,
  StaffUserStatus,
} from '@prisma/client';

export class RestaurantDetailBranchDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'Providencia' })
  name!: string;

  @ApiProperty({ nullable: true, required: false })
  address!: string | null;

  @ApiProperty({ enum: BranchStatus, enumName: 'BranchStatus' })
  status!: BranchStatus;
}

export class RestaurantDetailStaffBranchRoleDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ example: 'Providencia' })
  branchName!: string;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role!: Role;
}

export class RestaurantDetailStaffDto {
  @ApiProperty({ format: 'uuid' })
  staffUserId!: string;

  @ApiProperty({ nullable: true, required: false })
  email!: string | null;

  @ApiProperty({ example: 'Ana' })
  firstName!: string;

  @ApiProperty({ example: 'Diaz' })
  lastName!: string;

  @ApiProperty({ enum: StaffUserStatus, enumName: 'StaffUserStatus' })
  status!: StaffUserStatus;

  @ApiProperty({ type: [RestaurantDetailStaffBranchRoleDto] })
  branchRoles!: RestaurantDetailStaffBranchRoleDto[];
}

export class RestaurantDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'Sazono Bistro' })
  name!: string;

  @ApiProperty({ nullable: true, required: false })
  legalName!: string | null;

  @ApiProperty({ example: 'sazono-bistro' })
  slug!: string;

  @ApiProperty({ example: 1 })
  branchQuota!: number;

  @ApiProperty({ enum: RestaurantStatus, enumName: 'RestaurantStatus' })
  status!: RestaurantStatus;

  @ApiProperty({ example: 'CLP' })
  currency!: string;

  @ApiProperty({ example: 'America/Santiago' })
  timezone!: string;

  @ApiProperty({ example: 'es' })
  defaultLanguage!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: [RestaurantDetailBranchDto] })
  branches!: RestaurantDetailBranchDto[];

  @ApiProperty({ type: [RestaurantDetailStaffDto] })
  staff!: RestaurantDetailStaffDto[];
}
