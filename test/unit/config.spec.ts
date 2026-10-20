import { DATABASE_ENTITIES, createDatabaseOptions } from '../../src/config/database.config';
import { validateEnvironment } from '../../src/config/env.config';

describe('Configuración de entorno', () => {
  it('usa valores locales predeterminados sin requerir credenciales', () => {
    const config = validateEnvironment({});
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 5000,
      DB_NAME: 'GestorTareasDB',
      DB_ENCRYPT: true,
      DB_TRUST_SERVER_CERTIFICATE: false,
    });
  });

  it('convierte valores explícitos', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'development',
        PORT: '5100',
        DB_PORT: '1433',
        DB_ENCRYPT: 'true',
        DB_TRUST_SERVER_CERTIFICATE: 'false',
      }),
    ).toMatchObject({ PORT: 5100, DB_PORT: 1433, DB_TRUST_SERVER_CERTIFICATE: false });
  });

  it.each(['0', '65536', '3000abc', '1.5', '-1', ''])('rechaza PORT inválido %p', (value) => {
    expect(() => validateEnvironment({ PORT: value })).toThrow('PORT');
  });

  it('rechaza NODE_ENV y booleanos inválidos', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'staging' })).toThrow('NODE_ENV');
    expect(() => validateEnvironment({ NODE_ENV: '' })).toThrow('NODE_ENV');
    expect(() => validateEnvironment({ DB_ENCRYPT: 'false' })).toThrow('DB_ENCRYPT');
    expect(() => validateEnvironment({ DB_TRUST_SERVER_CERTIFICATE: 'yes' })).toThrow(
      'DB_TRUST_SERVER_CERTIFICATE',
    );
    expect(() =>
      validateEnvironment({ NODE_ENV: 'production', DB_TRUST_SERVER_CERTIFICATE: 'true' }),
    ).toThrow('DB_TRUST_SERVER_CERTIFICATE');
  });

  it('impide puerto e instancia simultáneos y otro nombre de base', () => {
    expect(() => validateEnvironment({ DB_PORT: '1433', DB_INSTANCE: 'SQLEXPRESS' })).toThrow(
      'DB_PORT o DB_INSTANCE',
    );
    expect(() => validateEnvironment({ DB_NAME: 'otra' })).toThrow('DB_NAME');
  });
});

describe('Configuración SQL Server', () => {
  const credentials = { DB_HOST: 'servidor-ejemplo', DB_USER: 'usuario-ejemplo', DB_PASSWORD: 'clave-ejemplo' };

  it('registra las siete entidades y no opera el esquema automáticamente', () => {
    expect(createDatabaseOptions({ ...credentials, DB_PORT: '1433' })).toMatchObject({
      type: 'mssql',
      host: 'servidor-ejemplo',
      port: 1433,
      connectionTimeout: 5000,
      requestTimeout: 5000,
      database: 'GestorTareasDB',
      entities: DATABASE_ENTITIES,
      synchronize: false,
      dropSchema: false,
      migrationsRun: false,
      options: { encrypt: true, trustServerCertificate: false },
    });
  });

  it('reutiliza valores ya validados por ConfigService', () => {
    expect(
      createDatabaseOptions({
        ...credentials,
        NODE_ENV: 'development',
        PORT: 5000,
        DB_PORT: 1433,
        DB_ENCRYPT: true,
        DB_TRUST_SERVER_CERTIFICATE: true,
      }),
    ).toMatchObject({ port: 1433, options: { encrypt: true, trustServerCertificate: true } });
  });

  it('acepta instancia nombrada sin puerto', () => {
    const options = createDatabaseOptions({ ...credentials, DB_INSTANCE: 'SQLEXPRESS' });
    expect(options).not.toHaveProperty('port');
    expect(options).toMatchObject({ options: { instanceName: 'SQLEXPRESS' } });
  });

  it('requiere credenciales y una opción de destino para db:check', () => {
    expect(() => createDatabaseOptions({ DB_PORT: '1433' })).toThrow('DB_HOST');
    expect(() => createDatabaseOptions(credentials)).toThrow('DB_PORT o DB_INSTANCE');
  });
});
