import { ConfigService } from '@nestjs/config';

export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_EXPIRES_IN = 1800;
export const JWT_ISSUER = 'gestor-tareas-api';
export const JWT_AUDIENCE = 'gestor-tareas-web';

export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<unknown>('JWT_SECRET');
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET debe contener al menos 32 bytes');
  }
  return secret;
}
