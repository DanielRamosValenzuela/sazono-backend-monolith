import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

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

export class UpdateDeviceTokenSoundDto {
  @ApiProperty({ example: 'f7z9...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  fcmToken!: string;

  @ApiProperty()
  @IsBoolean()
  soundEnabled!: boolean;
}

export class DeviceTokenSoundQueryDto {
  @ApiProperty({ example: 'f7z9...' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  fcmToken!: string;
}
