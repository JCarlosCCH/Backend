import { DataSource } from 'typeorm';
import { createDatabaseOptions, DATABASE_ENTITIES } from '../../src/config/database.config';
import { validateEnvironment } from '../../src/config/env.config';
import { Usuario } from '../../src/modules/usuarios/entities/usuario.entity';
import { Entrega } from '../../src/modules/entregas/entities/entrega.entity';
import { PdfStorageService } from '../../src/modules/files/pdf-storage.service';

class MetadataDataSource extends DataSource {
  async prepareMetadata(): Promise<void> { await this.buildMetadatas(); }
}

const target = { DATABASE_URL: 'postgresql://demo:p%40ss@localhost:5432/gestor_tareas_m851', DB_SSL: 'require' };

describe('PostgreSQL en Render', () => {
  it('toma el nombre real de la URL y conserva la contraseña codificada correctamente', () => {
    expect(validateEnvironment(target)).toMatchObject({ DB_TYPE: 'postgres', DB_NAME: 'gestor_tareas_m851' });
    expect(createDatabaseOptions(target)).toMatchObject({
      type: 'postgres', host: 'localhost', port: 5432, username: 'demo', password: 'p@ss',
      database: 'gestor_tareas_m851', schema: 'dbo', ssl: { rejectUnauthorized: false },
      synchronize: false, dropSchema: false, migrationsRun: false,
    });
    expect(createDatabaseOptions({ ...target, DB_SSL: 'verify-full' })).toMatchObject({ ssl: { rejectUnauthorized: true } });
    expect(createDatabaseOptions({ DATABASE_URL: 'postgresql://demo:pass@host/real_db', DB_PORT: '1433', DB_NAME: 'GestorTareasDB' }))
      .toMatchObject({ port: 5432, database: 'real_db' });
  });

  it('rechaza una URL de otro motor y parámetros SSL desconocidos', () => {
    expect(() => createDatabaseOptions({ DATABASE_URL: 'mysql://demo:secret@host/db' })).toThrow('DATABASE_URL');
    expect(() => createDatabaseOptions({ ...target, DB_SSL: 'inseguro' })).toThrow('DB_SSL');
    expect(() => createDatabaseOptions({ ...target, DB_TYPE: 'mssql' })).toThrow('DATABASE_URL');
  });

  it('construye metadatos válidos para los siete repositorios, sus claves y relaciones', async () => {
    const database = new MetadataDataSource(createDatabaseOptions(target));
    await database.prepareMetadata();
    expect(database.entityMetadatas).toHaveLength(7);
    for (const entity of DATABASE_ENTITIES) expect(database.hasMetadata(entity)).toBe(true);
    const usuario = database.getMetadata(Usuario);
    expect(usuario.findColumnWithPropertyName('contrasenaHash')).toMatchObject({ type: 'varchar', isSelect: false });
    expect(usuario.findColumnWithPropertyName('estado')).toMatchObject({ type: 'boolean' });
    expect(usuario.findColumnWithPropertyName('fechaRegistro')).toMatchObject({ type: 'timestamptz' });
    expect(usuario.generatedColumns.map((column) => column.propertyName)).toEqual(['idUsuario']);
    const entrega = database.getMetadata(Entrega);
    expect(entrega.relations.find((relation) => relation.propertyName === 'alumno')?.inverseEntityMetadata.tableName).toBe('Alumno');
    expect(entrega.uniques.some((unique) => unique.columns.map((column) => column.propertyName).join(',') === 'idTarea,idAlumno')).toBe(true);
  });

  it('recupera un PDF desde una nueva instancia del servicio sin depender del disco', async () => {
    const files = new Map<string, Buffer>();
    const query = jest.fn(async (sql: string, params: [string, Buffer?]) => {
      if (sql.startsWith('INSERT')) { files.set(params[0], Buffer.from(params[1]!)); return []; }
      if (sql.startsWith('DELETE')) { files.delete(params[0]); return []; }
      return files.has(params[0]) ? [{ Contenido: files.get(params[0]) }] : [];
    });
    const database = { options: { type: 'postgres' }, query } as unknown as DataSource;
    const first = new PdfStorageService(database);
    const content = Buffer.from('%PDF-1.4\ncontenido\n%%EOF');
    const name = await first.store({ originalname: 'demo.pdf', mimetype: 'application/pdf', size: content.length, buffer: content }, 'submission');
    const restarted = new PdfStorageService(database);
    expect((await restarted.read(name)).equals(content)).toBe(true);
    await restarted.remove(name);
    await expect(restarted.read(name)).rejects.toThrow('Archivo no disponible');
    await expect(restarted.read('../fuera.pdf')).rejects.toThrow('Archivo no disponible');
  });
});
