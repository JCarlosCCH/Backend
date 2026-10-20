import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { configureHttp } from '../../src/config/http.config';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { JWT_AUDIENCE, JWT_ISSUER } from '../../src/modules/auth/jwt.config';
import { PasswordHasherService } from '../../src/modules/auth/password-hasher.service';
import { Alumno } from '../../src/modules/usuarios/entities/alumno.entity';
import { Docente } from '../../src/modules/usuarios/entities/docente.entity';
import { Usuario } from '../../src/modules/usuarios/entities/usuario.entity';

const secret = 'test-secret-that-is-longer-than-thirty-two-bytes';
const teacher = { idUsuario: 21, nombres: 'Docente', apellidos: 'Prueba', correo: 'docente@example.test', estado: true, contrasenaHash: '' };
const student = { idUsuario: 22, nombres: 'Alumno', apellidos: 'Prueba', correo: 'alumno@example.test', estado: true, contrasenaHash: '' };
const inactive = { idUsuario: 23, nombres: 'Inactivo', apellidos: 'Prueba', correo: 'inactivo@example.test', estado: false, contrasenaHash: '' };

describe('Autenticación HTTP con repositorios simulados', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let users: typeof teacher[];
  let teacherIds: number[];
  let studentIds: number[];
  let databaseFailure: boolean;
  const hasher = new PasswordHasherService();

  beforeAll(async () => {
    const hash = await hasher.hash('contraseña-de-prueba');
    teacher.contrasenaHash = hash;
    student.contrasenaHash = hash;
    inactive.contrasenaHash = hash;
  });

  beforeEach(async () => {
    users = [teacher, student, inactive];
    teacherIds = [21];
    studentIds = [22, 23];
    databaseFailure = false;
    const usuarioRepository = {
      createQueryBuilder: () => ({
        addSelect() { return this; },
        where(_sql: string, params: { correo: string }) {
          return { getOne: async () => {
            if (databaseFailure) throw new Error('detalle privado SQL');
            return users.find((user) => user.correo === params.correo) ?? null;
          } };
        },
      }),
      findOneBy: async ({ idUsuario }: { idUsuario: number }) => {
        if (databaseFailure) throw new Error('detalle privado SQL');
        return users.find((user) => user.idUsuario === idUsuario) ?? null;
      },
    };
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret, signOptions: { algorithm: 'HS256', expiresIn: 1800, issuer: JWT_ISSUER, audience: JWT_AUDIENCE } }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
      ],
      controllers: [AuthController],
      providers: [
        AuthService, PasswordHasherService, JwtAuthGuard,
        { provide: ConfigService, useValue: { get: (key: string) => key === 'JWT_SECRET' ? secret : undefined } },
        { provide: getRepositoryToken(Usuario), useValue: usuarioRepository },
        { provide: getRepositoryToken(Docente), useValue: { existsBy: async ({ idDocente }: { idDocente: number }) => {
          if (databaseFailure) throw new Error('detalle privado SQL');
          return teacherIds.includes(idDocente);
        } } },
        { provide: getRepositoryToken(Alumno), useValue: { existsBy: async ({ idAlumno }: { idAlumno: number }) => {
          if (databaseFailure) throw new Error('detalle privado SQL');
          return studentIds.includes(idAlumno);
        } } },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, 'test');
    await app.init();
    jwt = app.get(JwtService);
  });

  afterEach(async () => { await app.close(); });

  const body = (correo: string, contrasena = 'contraseña-de-prueba') => ({ correo, contrasena });

  it.each([
    ['docente@example.test', 'DOCENTE', 21],
    ['alumno@example.test', 'ALUMNO', 22],
  ])('acepta %s y /me consulta el perfil real', async (correo, rol, idUsuario) => {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send(body(String(correo))).expect(200);
    expect(login.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 1800, usuario: { idUsuario, rol, correo } });
    expect(JSON.stringify(login.body)).not.toContain('contrasenaHash');
    const claims = jwt.decode(login.body.accessToken) as Record<string, unknown>;
    expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub']);
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
    expect(me.body).toEqual(login.body.usuario);
    expect(JSON.stringify(me.body)).not.toContain('contrasenaHash');
  });

  it.each([
    ['docente@example.test', 'otra-clave'],
    ['desconocido@example.test', 'contraseña-de-prueba'],
    ['inactivo@example.test', 'contraseña-de-prueba'],
  ])('rechaza credenciales, cuenta inexistente o inactiva con 401 genérico', async (correo, contrasena) => {
    const response = await request(app.getHttpServer()).post('/api/auth/login').send(body(correo, contrasena)).expect(401);
    expect(response.body.message).toBe('Credenciales no válidas');
  });

  it('rechaza usuario sin perfil o con ambos perfiles', async () => {
    teacherIds = [];
    await request(app.getHttpServer()).post('/api/auth/login').send(body(teacher.correo)).expect(401);
    teacherIds = [21];
    studentIds.push(21);
    await request(app.getHttpServer()).post('/api/auth/login').send(body(teacher.correo)).expect(401);
  });

  it('rechaza propiedades ajenas y tipos incorrectos', async () => {
    await request(app.getHttpServer()).post('/api/auth/login').send({ ...body(teacher.correo), rol: 'DOCENTE' }).expect(400);
    await request(app.getHttpServer()).post('/api/auth/login').send({ correo: teacher.correo, contrasena: 1 }).expect(400);
  });

  it('requiere token válido, firma correcta, expiración, emisor y audiencia', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', 'Bearer alterado').expect(401);
    for (const options of [
      { expiresIn: -1, issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      { expiresIn: 1800, issuer: 'otro', audience: JWT_AUDIENCE },
      { expiresIn: 1800, issuer: JWT_ISSUER, audience: 'otra' },
    ]) {
      const token = await jwt.signAsync({ sub: 21 }, { ...options, algorithm: 'HS256' });
      await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    }
    const wrongAlgorithm = await jwt.signAsync({ sub: 21 }, { algorithm: 'HS384' });
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${wrongAlgorithm}`).expect(401);
  });

  it('vuelve a consultar estado y perfil en /me', async () => {
    const token = await jwt.signAsync({ sub: 21 });
    users = [{ ...teacher, estado: false }, student, inactive];
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('devuelve 503 sin detalle privado ante fallo de SQL', async () => {
    databaseFailure = true;
    const response = await request(app.getHttpServer()).post('/api/auth/login').send(body(teacher.correo)).expect(503);
    expect(response.body.message).toBe('Servicio de autenticación no disponible');
    expect(JSON.stringify(response.body)).not.toContain('detalle privado');
    const token = await jwt.signAsync({ sub: 21 });
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(503);
  });

  it('limita el sexto intento de login a HTTP 429', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(app.getHttpServer()).post('/api/auth/login').send(body('desconocido@example.test')).expect(401);
    }
    await request(app.getHttpServer()).post('/api/auth/login').send(body('desconocido@example.test')).expect(429);
  });
});
