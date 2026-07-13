import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SearchRestaurantsQueryDto {
  @ApiProperty({ example: 'sazono' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  q!: string;
}

export class RestaurantSearchResultDto {
  @ApiProperty({ example: 'Sazono Bistro' })
  name!: string;

  @ApiProperty({ example: 'sazono-bistro' })
  slug!: string;
}
