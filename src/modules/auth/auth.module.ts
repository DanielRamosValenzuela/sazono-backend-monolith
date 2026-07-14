import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_PROVIDER } from './application/ports/auth-provider.port';
import { SupabaseAuthProvider } from './infrastructure/providers/supabase-auth.provider';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn = (configService.get<string>(
          'JWT_ACCESS_TOKEN_EXPIRES_IN',
        ) ?? '8h') as StringValue;

        return {
          secret:
            configService.get<string>('JWT_ACCESS_TOKEN_SECRET') ?? 'change-me',
          signOptions: {
            expiresIn,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    SupabaseAuthProvider,
    {
      provide: AUTH_PROVIDER,
      useExisting: SupabaseAuthProvider,
    },
  ],
  exports: [AuthService, AUTH_PROVIDER],
})
export class AuthModule {}
