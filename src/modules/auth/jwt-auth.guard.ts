import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { PublicUser } from './auth.types';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, requireJwtSecret } from './jwt.config';

export type AuthenticatedRequest = Request & { authUser: PublicUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !/^Bearer\s+\S+$/.test(header)) {
      throw new UnauthorizedException('Autenticación requerida');
    }
    const token = header.slice(7);
    let payload: { sub?: unknown };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
        secret: requireJwtSecret(this.config),
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        ignoreExpiration: false,
      });
    } catch {
      throw new UnauthorizedException('Autenticación requerida');
    }
    if (!Number.isSafeInteger(payload.sub) || Number(payload.sub) < 1) {
      throw new UnauthorizedException('Autenticación requerida');
    }
    request.authUser = await this.auth.currentUser(Number(payload.sub));
    return true;
  }
}
