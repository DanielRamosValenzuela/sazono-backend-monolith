import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MenuCategoryStatus,
  MenuItemType,
  MenuStatus,
  PreparationStationStatus,
  PreparationStationType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

class PreparationStationSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  preparationStationId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: PreparationStationType,
    enumName: 'PreparationStationType',
  })
  stationType!: PreparationStationType;

  @ApiProperty({
    enum: PreparationStationStatus,
    enumName: 'PreparationStationStatus',
  })
  status!: PreparationStationStatus;
}

class MenuItemSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  menuItemId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, required: false })
  description!: string | null;

  @ApiProperty({ example: '11900' })
  price!: string;

  @ApiProperty({ nullable: true, required: false })
  sku!: string | null;

  @ApiProperty({ enum: MenuItemType, enumName: 'MenuItemType' })
  itemType!: MenuItemType;

  @ApiProperty()
  isAvailable!: boolean;

  @ApiProperty({ type: PreparationStationSummaryResponseDto })
  preparationStation!: PreparationStationSummaryResponseDto;
}

export class MenuCategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  menuCategoryId!: string;

  @ApiProperty({ format: 'uuid' })
  menuId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({
    enum: MenuCategoryStatus,
    enumName: 'MenuCategoryStatus',
  })
  status!: MenuCategoryStatus;
}

class MenuCategoryDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  menuCategoryId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({
    enum: MenuCategoryStatus,
    enumName: 'MenuCategoryStatus',
  })
  status!: MenuCategoryStatus;

  @ApiProperty({ type: [MenuItemSummaryResponseDto] })
  items!: MenuItemSummaryResponseDto[];
}

export class PreparationStationResponseDto {
  @ApiProperty({ format: 'uuid' })
  preparationStationId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({
    enum: PreparationStationType,
    enumName: 'PreparationStationType',
  })
  stationType!: PreparationStationType;

  @ApiProperty({
    enum: PreparationStationStatus,
    enumName: 'PreparationStationStatus',
  })
  status!: PreparationStationStatus;
}

export class MenuItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  menuItemId!: string;

  @ApiProperty({ format: 'uuid' })
  menuCategoryId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, required: false })
  description!: string | null;

  @ApiProperty({ example: '5900' })
  price!: string;

  @ApiProperty({ nullable: true, required: false })
  sku!: string | null;

  @ApiProperty({ enum: MenuItemType, enumName: 'MenuItemType' })
  itemType!: MenuItemType;

  @ApiProperty()
  isAvailable!: boolean;

  @ApiProperty({ type: PreparationStationSummaryResponseDto })
  preparationStation!: PreparationStationSummaryResponseDto;
}

export class MenuListItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  menuId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: MenuStatus, enumName: 'MenuStatus' })
  status!: MenuStatus;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  defaultLanguage!: string;

  @ApiProperty({ nullable: true, required: false })
  publishedAt!: string | null;

  @ApiProperty()
  isDefaultMenu!: boolean;

  @ApiProperty()
  categoryCount!: number;

  @ApiProperty()
  itemCount!: number;
}

export class MenuDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  menuId!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: MenuStatus, enumName: 'MenuStatus' })
  status!: MenuStatus;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  defaultLanguage!: string;

  @ApiProperty({ nullable: true, required: false })
  publishedAt!: string | null;

  @ApiProperty()
  isDefaultMenu!: boolean;

  @ApiProperty({ type: [MenuCategoryDetailResponseDto] })
  categories!: MenuCategoryDetailResponseDto[];
}

export class CreatePreparationStationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: 'Cocina caliente' })
  @IsString()
  @MaxLength(80)
  name!: string;

  @ApiProperty({
    enum: PreparationStationType,
    enumName: 'PreparationStationType',
  })
  @IsEnum(PreparationStationType)
  stationType!: PreparationStationType;
}

export class ListPreparationStationsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;
}

export class CreateMenuDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: 'Carta invierno 2026' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'es' })
  @IsString()
  @MaxLength(10)
  defaultLanguage!: string;
}

export class ListMenusQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  branchId!: string;
}

export class CreateMenuCategoryDto {
  @ApiProperty({ example: 'Fondos' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateMenuItemDto {
  @ApiProperty({ example: 'Pisco Sour' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Pisco, limon, goma y clara.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: '5900' })
  @IsNumberString()
  price!: string;

  @ApiPropertyOptional({ example: 'TRG-001' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @ApiProperty({ enum: MenuItemType, enumName: 'MenuItemType' })
  @IsEnum(MenuItemType)
  itemType!: MenuItemType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  preparationStationId!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}
