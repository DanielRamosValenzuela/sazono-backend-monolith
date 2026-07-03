import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

type SupabaseServerClient = ReturnType<typeof createClient>;

@Injectable()
export class SupabaseService {
  private publicClientInstance?: SupabaseServerClient;
  private adminClientInstance?: SupabaseServerClient;

  constructor(private readonly configService: ConfigService) {}

  get publicClient(): SupabaseServerClient {
    this.publicClientInstance ??=
      this.createClientFromConfig('SUPABASE_ANON_KEY');

    return this.publicClientInstance;
  }

  get adminClient(): SupabaseServerClient {
    this.adminClientInstance ??= this.createClientFromConfig(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    return this.adminClientInstance;
  }

  private createClientFromConfig(
    keyName: 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY',
  ): SupabaseServerClient {
    const supabaseUrl = this.getRequiredConfig('SUPABASE_URL');
    const supabaseKey = this.getRequiredConfig(keyName);

    return createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  private getRequiredConfig(name: string): string {
    const value = this.configService.get<string>(name)?.trim();

    if (!value) {
      throw new Error(
        `Supabase Auth no esta configurado correctamente. Falta ${name}.`,
      );
    }

    return value;
  }
}
