import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

const PIN_PATTERN = /^\d{4,6}$/;

export class SetPinDto {
  @ApiProperty({ example: '1234' })
  @Matches(PIN_PATTERN, { message: 'El PIN debe tener entre 4 y 6 digitos.' })
  pin!: string;
}

export class PinLoginDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  staffUserId!: string;

  @ApiProperty({ example: '1234' })
  @Matches(PIN_PATTERN, { message: 'El PIN debe tener entre 4 y 6 digitos.' })
  pin!: string;
}
