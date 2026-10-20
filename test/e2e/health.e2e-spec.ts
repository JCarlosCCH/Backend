import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/config/http.config';
import { DatabaseModule } from '../../src/database/database.module';

const databaseQuery = jest.fn().mockResolvedValue([{ ok: 1 }]);
const repository = { createQueryBuilder: jest.fn(), findOneBy: jest.fn(), existsBy: jest.fn() };

@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: {
    query: databaseQuery,
    entityMetadatas: [],
    options: { type: 'mssql' },
    getRepository: () => repository,
  } }],
  exports: [getDataSourceToken()],
})
class FakeDatabaseModule {}

describe('API HTTP', () => {
  let app: INestApplication;

  beforeAll(() => { process.env.JWT_SECRET = 'test-secret-that-is-longer-than-thirty-two-bytes'; });

  async function createApp(environment: 'test' | 'development' | 'production') {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    const application = module.createNestApplication();
    configureHttp(application, environment);
    await application.init();
    return application;
  }

  beforeAll(async () => {
    app = await createApp('test');
  });

  beforeEach(() => databaseQuery.mockReset().mockResolvedValue([{ ok: 1 }]));

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/health responde 200 con el cuerpo exacto', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://example.test')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'gestor-tareas-backend' });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responde 404 para una ruta inexistente', async () => {
    await request(app.getHttpServer()).get('/api/ruta-inexistente').expect(404);
  });

  it('GET /api/health/database responde 200 si el doble de base responde', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/database').expect(200);
    expect(response.body).toEqual({ status: 'available' });
    expect(databaseQuery).toHaveBeenCalledWith('SELECT 1 AS ok');
  });

  it('GET /api/health/database responde 503 genérico si el doble falla', async () => {
    databaseQuery.mockRejectedValue(new Error('detalle privado del servidor'));
    const response = await request(app.getHttpServer()).get('/api/health/database').expect(503);
    expect(response.body).toMatchObject({ message: 'Base de datos no disponible' });
    expect(JSON.stringify(response.body)).not.toContain('detalle privado');
  });

  it('no publica Swagger ni rutas funcionales en pruebas', async () => {
    await request(app.getHttpServer()).get('/docs').expect(404);
    await request(app.getHttpServer()).get('/docs-json').expect(404);
    await request(app.getHttpServer()).post('/api/auth/login').send({}).expect(400);
  });

  it('publica en desarrollo solo las rutas implementadas en OpenAPI', async () => {
    const developmentApp = await createApp('development');
    try {
      await request(developmentApp.getHttpServer()).get('/docs').expect(200);
      const response = await request(developmentApp.getHttpServer()).get('/docs-json').expect(200);
      expect(response.body.info.title).toBe('Gestor de Tareas - API');
      expect(Object.keys(response.body.paths)).toEqual([
        '/api/health', '/api/health/database', '/api/auth/login', '/api/auth/me',
        '/api/cursos', '/api/cursos/{id}/tareas', '/api/tareas/{id}',
        '/api/tareas/{id}/archivo', '/api/tareas/{id}/entregas',
        '/api/tareas/{id}/mi-entrega', '/api/entregas/{id}/archivo',
        '/api/entregas/{id}/calificacion',
      ]);
    } finally {
      await developmentApp.close();
    }
  });

  it('no publica Swagger en producción', async () => {
    const productionApp = await createApp('production');
    try {
      await request(productionApp.getHttpServer()).get('/docs').expect(404);
      await request(productionApp.getHttpServer()).get('/docs-json').expect(404);
    } finally {
      await productionApp.close();
    }
  });
});
