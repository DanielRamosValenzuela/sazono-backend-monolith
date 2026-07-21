import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;

export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export class RegisterDeviceTokenDto {
  @ApiProperty({ example: 'f7z9...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  fcmToken!: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS })
  @IsIn(DEVICE_PLATFORMS)
  platform!: DevicePlatform;
}

export class UnregisterDeviceTokenDto {
  @ApiProperty({ example: 'f7z9...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  fcmToken!: string;
}
