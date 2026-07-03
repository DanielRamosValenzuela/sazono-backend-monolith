import type { Request } from 'express';
import type { JwtPayload } from './jwt-payload.interface';

export type AuthenticatedRequest = Request & {
  user: JwtPayload;
};

export type MaybeAuthenticatedRequest = Request & {
  user?: JwtPayload;
};
