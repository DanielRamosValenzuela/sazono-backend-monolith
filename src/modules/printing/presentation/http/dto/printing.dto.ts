import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PrintDeviceKind,
  PrintJobKind,
  PrintJobStatus,
  PrinterTransport,
} from '@prisma/client';

export const PAPER_WIDTHS = [58, 80];
export const COLUMN_OPTIONS = [32, 35, 42, 48];
export const PRINT_CODE_PATTERN = /^[A-Za-z0-9]{1,4}$/;

export class CreatePrinterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsEnum(PrinterTransport)
  transport!: PrinterTransport;

  @IsOptional()
  @IsObject()
  connection?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsIn(PAPER_WIDTHS)
  paperWidthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn(COLUMN_OPTIONS)
  columns?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  codepage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(255)
  escTCodepageId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  copies?: number;

  @IsOptional()
  @IsBoolean()
  autoCut?: boolean;

  @IsOptional()
  @IsBoolean()
  cashDrawer?: boolean;

  @IsOptional()
  @IsBoolean()
  printVoidSlips?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  stationIds?: string[];
}

export class UpdatePrinterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsEnum(PrinterTransport)
  transport?: PrinterTransport;

  @IsOptional()
  @IsObject()
  connection?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsIn(PAPER_WIDTHS)
  paperWidthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn(COLUMN_OPTIONS)
  columns?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  codepage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(255)
  escTCodepageId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  copies?: number;

  @IsOptional()
  @IsBoolean()
  autoCut?: boolean;

  @IsOptional()
  @IsBoolean()
  cashDrawer?: boolean;

  @IsOptional()
  @IsBoolean()
  printVoidSlips?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class SetPrinterStationsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  stationIds!: string[];
}

export class UpdatePrintStationDto {
  @IsOptional()
  @Matches(PRINT_CODE_PATTERN, {
    message: 'El codigo de impresion debe tener de 1 a 4 letras o numeros.',
  })
  printCode?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  printerIds?: string[];
}

export class ListPrintJobsQueryDto {
  @IsOptional()
  @IsEnum(PrintJobStatus)
  status?: PrintJobStatus;

  @IsOptional()
  @IsEnum(PrintJobKind)
  kind?: PrintJobKind;

  @IsOptional()
  @IsUUID()
  printerId?: string;

  @IsOptional()
  @IsUUID()
  stationTicketId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsDateString()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SamplePreviewQueryDto {
  @IsOptional()
  @IsUUID()
  printerId?: string;

  @IsOptional()
  @IsUUID()
  stationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn(PAPER_WIDTHS)
  paperWidthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn(COLUMN_OPTIONS)
  columns?: number;
}

export class CreatePrintDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsEnum(PrintDeviceKind)
  kind?: PrintDeviceKind;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  printerIds?: string[];
}

export class UpdatePrintDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  printerIds?: string[];
}

export class PairDeviceDto {
  @Matches(/^\d{6}$/, { message: 'El codigo debe tener 6 digitos.' })
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsEnum(PrintDeviceKind)
  kind!: PrintDeviceKind;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}

export class HeartbeatPrinterDto {
  @IsUUID()
  printerId!: string;

  @IsBoolean()
  ok!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  detail?: string;
}

export class HeartbeatDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HeartbeatPrinterDto)
  printers?: HeartbeatPrinterDto[];
}

export class DevicePrintersDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  printerIds!: string[];
}

export class NextJobsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(55)
  wait?: number;
}

export class AckJobDto {
  @IsOptional()
  @IsDateString()
  printedAt?: string;
}

export class FailJobDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  code!: string;

  @IsString()
  @MaxLength(400)
  message!: string;

  @IsBoolean()
  retryable!: boolean;
}
