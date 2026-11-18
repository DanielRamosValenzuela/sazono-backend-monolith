import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlatformFeeStatementStatus } from '@prisma/client';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export class StatementPeriodQueryDto {
  @ApiProperty({ example: '2026-10' })
  @Matches(PERIOD_REGEX, { message: 'period debe tener formato YYYY-MM.' })
  period!: string;
}

export class StatementExportQueryDto extends StatementPeriodQueryDto {
  @ApiProperty({ enum: ['csv'] })
  @IsIn(['csv'])
  format!: 'csv';
}

export class UpdateStatementStatusDto {
  @ApiProperty({ enum: ['PAID', 'WAIVED', 'VOID'] })
  @IsIn(['PAID', 'WAIVED', 'VOID'])
  status!: Extract<PlatformFeeStatementStatus, 'PAID' | 'WAIVED' | 'VOID'>;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
