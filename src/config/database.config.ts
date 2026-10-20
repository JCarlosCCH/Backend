import { DataSourceOptions } from 'typeorm';
import { Alumno } from '../modules/usuarios/entities/alumno.entity';
import { Docente } from '../modules/usuarios/entities/docente.entity';
import { Usuario } from '../modules/usuarios/entities/usuario.entity';
import { Curso } from '../modules/cursos/entities/curso.entity';
import { Matricula } from '../modules/matriculas/entities/matricula.entity';
import { Tarea } from '../modules/tareas/entities/tarea.entity';
import { Entrega } from '../modules/entregas/entities/entrega.entity';
import { validateEnvironment } from './env.config';
import { createPostgresEntities } from '../database/postgres-entities';

export const DATABASE_NAME = 'GestorTareasDB';
export const AUTH_ENTITIES = [Usuario, Docente, Alumno];
export const DATABASE_ENTITIES = [...AUTH_ENTITIES, Curso, Matricula, Tarea, Entrega];

export function createDatabaseOptions(raw: Record<string, unknown>): DataSourceOptions {
  const config = validateEnvironment(raw);
  if (config.DB_TYPE === 'postgres') {
    const url = config.DATABASE_URL ? new URL(config.DATABASE_URL as string) : undefined;
    const host = url?.hostname ?? config.DB_HOST as string | undefined;
    const username = url ? decodeURIComponent(url.username) : config.DB_USER as string | undefined;
    const password = url ? decodeURIComponent(url.password) : config.DB_PASSWORD as string | undefined;
    const database = config.DB_NAME as string | undefined;
    if (!host || !username || !password || !database) {
      throw new Error('Configure DATABASE_URL o DB_HOST, DB_USER, DB_PASSWORD y DB_NAME para PostgreSQL');
    }
    return {
      type: 'postgres', host, username, password, database,
      port: url ? Number(url.port || 5432) : (config.DB_PORT as number | undefined) ?? 5432,
      schema: 'dbo',
      ssl: config.DB_SSL === 'disable' ? false : { rejectUnauthorized: config.DB_SSL !== 'require' },
      connectTimeoutMS: 15000,
      extra: { max: 5, statement_timeout: 15000 },
      entities: createPostgresEntities(DATABASE_ENTITIES),
      synchronize: false, dropSchema: false, migrationsRun: false, logging: false,
    };
  }
  const host = config.DB_HOST as string | undefined;
  const username = config.DB_USER as string | undefined;
  const password = config.DB_PASSWORD as string | undefined;
  const port = config.DB_PORT as number | undefined;
  const instanceName = config.DB_INSTANCE as string | undefined;

  if (!host || !username || !password) {
    throw new Error('DB_HOST, DB_USER y DB_PASSWORD son obligatorios para SQL Server');
  }
  if (port === undefined && !instanceName) {
    throw new Error('Configure DB_PORT o DB_INSTANCE para SQL Server');
  }

  return {
    type: 'mssql',
    host,
    ...(port === undefined ? {} : { port }),
    connectionTimeout: 5000,
    requestTimeout: 5000,
    username,
    password,
    database: DATABASE_NAME,
    entities: DATABASE_ENTITIES,
    synchronize: false,
    dropSchema: false,
    migrationsRun: false,
    logging: false,
    options: {
      encrypt: true,
      trustServerCertificate: config.DB_TRUST_SERVER_CERTIFICATE as boolean,
      ...(instanceName ? { instanceName } : {}),
    },
  };
}
