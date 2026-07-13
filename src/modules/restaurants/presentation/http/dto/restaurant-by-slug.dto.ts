import { ApiProperty } from '@nestjs/swagger';

export class RestaurantBySlugResponseDto {
  @ApiProperty({ example: 'Sazono Bistro' })
  name!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;
}
