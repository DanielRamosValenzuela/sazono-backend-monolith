import { SetMetadata } from '@nestjs/common';
import { LoginProfileType } from '../dto/login.dto';

export const REQUIRED_PROFILE_TYPE_KEY = 'required_profile_type';

export const RequireProfileType = (profileType: LoginProfileType) =>
  SetMetadata(REQUIRED_PROFILE_TYPE_KEY, profileType);
