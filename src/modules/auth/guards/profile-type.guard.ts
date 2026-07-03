import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PROFILE_TYPE_KEY } from '../decorators/require-profile-type.decorator';
import { LoginProfileType } from '../dto/login.dto';
import type { MaybeAuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class ProfileTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredProfileType =
      this.reflector.getAllAndOverride<LoginProfileType>(
        REQUIRED_PROFILE_TYPE_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!requiredProfileType) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<MaybeAuthenticatedRequest>();
    const user: JwtPayload | undefined = request.user;

    if (!user || user.profileType !== requiredProfileType) {
      throw new ForbiddenException(
        'El perfil autenticado no tiene permiso para este endpoint.',
      );
    }

    return true;
  }
}
