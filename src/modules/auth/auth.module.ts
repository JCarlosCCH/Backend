import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AUTH_ENTITIES } from '../../config/database.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_EXPIRES_IN, JWT_ISSUER, requireJwtSecret } from './jwt.config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordHasherService } from './password-hasher.service';

@Module({
  imports: [
    TypeOrmModule.forFeature(AUTH_ENTITIES),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
        signOptions: {
          algorithm: JWT_ALGORITHM,
          expiresIn: JWT_EXPIRES_IN,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordHasherService, JwtAuthGuard],
  exports: [PasswordHasherService, JwtAuthGuard, AuthService, JwtModule],
})
export class AuthModule {}
