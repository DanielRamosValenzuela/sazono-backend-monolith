import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../../common/supabase/supabase.service';
import {
  AuthenticatedIdentity,
  AuthProvider,
  CreateAuthUserInput,
} from '../../application/ports/auth-provider.port';

@Injectable()
export class SupabaseAuthProvider implements AuthProvider {
  constructor(private readonly supabaseService: SupabaseService) {}

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<AuthenticatedIdentity | null> {
    const { data, error } =
      await this.supabaseService.publicClient.auth.signInWithPassword({
        email,
        password,
      });

    if (error || !data.user) {
      return null;
    }

    return {
      authUserId: data.user.id,
      email: data.user.email ?? null,
    };
  }

  async getUserById(authUserId: string): Promise<AuthenticatedIdentity | null> {
    const { data, error } =
      await this.supabaseService.adminClient.auth.admin.getUserById(authUserId);

    if (error || !data.user) {
      return null;
    }

    return {
      authUserId: data.user.id,
      email: data.user.email ?? null,
    };
  }

  async findUserByEmail(email: string): Promise<AuthenticatedIdentity | null> {
    const normalizedEmail = email.trim().toLowerCase();
    let page = 1;
    const perPage = 1000;

    while (true) {
      const { data, error } =
        await this.supabaseService.adminClient.auth.admin.listUsers({
          page,
          perPage,
        });

      if (error) {
        throw error;
      }

      const matchedUser = data.users.find(
        (user) => user.email?.trim().toLowerCase() === normalizedEmail,
      );

      if (matchedUser) {
        return {
          authUserId: matchedUser.id,
          email: matchedUser.email ?? null,
        };
      }

      if (data.users.length < perPage) {
        return null;
      }

      page += 1;
    }
  }

  async createUser(input: CreateAuthUserInput): Promise<AuthenticatedIdentity> {
    const { data, error } =
      await this.supabaseService.adminClient.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: input.emailConfirmed ?? true,
        user_metadata: input.userMetadata,
      });

    if (error || !data.user) {
      throw error ?? new Error('No se pudo crear el usuario en Supabase Auth.');
    }

    return {
      authUserId: data.user.id,
      email: data.user.email ?? null,
    };
  }

  async deleteUser(authUserId: string): Promise<void> {
    const { error } =
      await this.supabaseService.adminClient.auth.admin.deleteUser(authUserId);

    if (error) {
      throw error;
    }
  }
}
