import type { LoginProfileType } from '../dto/login.dto';

export interface JwtPayload {
  sub: string;
  profileType: LoginProfileType;
  profileId: string;
  restaurantId?: string;
}

export interface RefreshTokenPayload extends JwtPayload {
  type: 'refresh';
}
