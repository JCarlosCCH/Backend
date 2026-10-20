import { ConfigModuleOptions } from '@nestjs/config';

export type NodeEnvironment = 'development' | 'test' | 'production';

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('El valor debe ser texto');
  const result = value.trim();
  return result || undefined;
}

function optionalSecret(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('DB_PASSWORD debe ser texto');
  return value;
}

function portNumber(value: unknown, name: string, allowEmpty = false): number | undefined {
  if (value === undefined || value === null || (value === '' && allowEmpty)) return undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65535) {
    return value;
  }
  if (typeof value !== 'string') throw new Error(`${name} debe ser un entero entre 1 y 65535`);
  const text = value.trim();
  if (!/^[0-9]+$/.test(text)) throw new Error(`${name} debe ser un entero entre 1 y 65535`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${name} debe ser un entero entre 1 y 65535`);
  }
  return number;
}

function booleanValue(value: unknown, name: string, defaultValue: boolean): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${name} debe ser true o false`);
}

export function validateEnvironment(raw: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = raw.NODE_ENV === undefined || raw.NODE_ENV === null ? 'development' : raw.NODE_ENV;
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV debe ser development, test o production');
  }

  const port = portNumber(raw.PORT, 'PORT') ?? 5000;
  const dbPort = portNumber(raw.DB_PORT, 'DB_PORT', true);
  const dbInstance = optionalText(raw.DB_INSTANCE);
  if (dbPort !== undefined && dbInstance !== undefined) {
    throw new Error('Configure DB_PORT o DB_INSTANCE, nunca ambos');
  }

  const databaseUrl = optionalText(raw.DATABASE_URL);
  const dbType = raw.DB_TYPE ?? (databaseUrl ? 'postgres' : 'mssql');
  if (dbType !== 'mssql' && dbType !== 'postgres') throw new Error('DB_TYPE debe ser mssql o postgres');
  let urlDatabase: string | undefined;
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
        throw new Error();
      }
      urlDatabase = decodeURIComponent(url.pathname.slice(1));
    } catch { throw new Error('DATABASE_URL debe ser una URL PostgreSQL válida'); }
  }
  if (dbType === 'mssql' && databaseUrl) throw new Error('DATABASE_URL requiere DB_TYPE=postgres');
  if (dbType === 'mssql' && raw.DB_NAME !== undefined && raw.DB_NAME !== null && raw.DB_NAME !== 'GestorTareasDB') {
    throw new Error('DB_NAME debe ser GestorTareasDB');
  }

  const encrypt = booleanValue(raw.DB_ENCRYPT, 'DB_ENCRYPT', true);
  if (!encrypt) throw new Error('DB_ENCRYPT debe permanecer en true');
  const trustCertificate = booleanValue(
    raw.DB_TRUST_SERVER_CERTIFICATE,
    'DB_TRUST_SERVER_CERTIFICATE',
    false,
  );
  if (dbType === 'mssql' && trustCertificate && nodeEnv !== 'development') {
    throw new Error('DB_TRUST_SERVER_CERTIFICATE=true solo se permite en development');
  }

  const dbSsl = optionalText(raw.DB_SSL) ?? 'verify-full';
  if (!['disable', 'require', 'verify-full'].includes(dbSsl)) {
    throw new Error('DB_SSL debe ser disable, require o verify-full');
  }

  if (raw.JWT_EXPIRES_IN !== undefined && raw.JWT_EXPIRES_IN !== '1800') {
    throw new Error('JWT_EXPIRES_IN debe ser 1800 segundos');
  }

  return {
    ...raw,
    NODE_ENV: nodeEnv,
    PORT: port,
    DB_TYPE: dbType,
    DATABASE_URL: databaseUrl,
    DB_SSL: dbSsl,
    DB_HOST: optionalText(raw.DB_HOST),
    DB_PORT: dbPort,
    DB_INSTANCE: dbInstance,
    DB_NAME: dbType === 'mssql' ? 'GestorTareasDB' : (urlDatabase ?? optionalText(raw.DB_NAME)),
    DB_USER: optionalText(raw.DB_USER),
    DB_PASSWORD: optionalSecret(raw.DB_PASSWORD),
    DB_ENCRYPT: encrypt,
    DB_TRUST_SERVER_CERTIFICATE: trustCertificate,
    JWT_EXPIRES_IN: 1800,
  };
}

export const envConfig: ConfigModuleOptions = {
  isGlobal: true,
  envFilePath: '.env',
  ignoreEnvFile: process.env.NODE_ENV === 'test',
  validate: validateEnvironment,
};
