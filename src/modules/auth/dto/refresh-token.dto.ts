import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'Refresh token emitido en el login o en una renovacion previa.',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
