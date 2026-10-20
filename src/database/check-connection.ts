import 'dotenv/config';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { classifyDatabaseError, DatabaseErrorCategory } from './connection-error';

async function checkConnection(): Promise<void> {
  let dataSource: DataSource | undefined;
  let verified = false;
  let phase: 'configuration' | 'connection' | 'query' = 'configuration';
  let failure: DatabaseErrorCategory = 'desconocido';
  try {
    const options = createDatabaseOptions(process.env);
    dataSource = new DataSource(options);
    phase = 'connection';
    await dataSource.initialize();
    phase = 'query';
    const rows: Array<{ base_actual: string; ok: number }> = await dataSource.query(
      options.type === 'postgres' ? 'SELECT current_database() AS base_actual, 1 AS ok' : 'SELECT DB_NAME() AS base_actual, 1 AS ok',
    );
    if (rows.length !== 1 || rows[0].ok !== 1 || rows[0].base_actual !== options.database) {
      throw new Error('La comprobación no devolvió la base esperada');
    }
    verified = true;
  } catch (error) {
    verified = false;
    failure = classifyDatabaseError(error, phase);
  } finally {
    try {
      if (dataSource?.isInitialized) await dataSource.destroy();
    } catch {
      verified = false;
      failure = 'conectividad';
    }
  }

  if (verified) {
    process.stdout.write('Conexión a la base configurada verificada: ok=1\n');
  } else {
    process.stderr.write(`No se pudo verificar la conexión a la base configurada (${failure}).\n`);
    process.exitCode = 1;
  }
}

void checkConnection();
