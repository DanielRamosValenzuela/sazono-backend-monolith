export interface AuthenticatedIdentity {
  authUserId: string;
  email: string | null;
}

export interface CreateAuthUserInput {
  email: string;
  password: string;
  emailConfirmed?: boolean;
  userMetadata?: Record<string, unknown>;
}

export interface AuthProvider {
  signInWithPassword(
    email: string,
    password: string,
  ): Promise<AuthenticatedIdentity | null>;
  findUserByEmail(email: string): Promise<AuthenticatedIdentity | null>;
  getUserById(authUserId: string): Promise<AuthenticatedIdentity | null>;
  createUser(input: CreateAuthUserInput): Promise<AuthenticatedIdentity>;
  deleteUser(authUserId: string): Promise<void>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
