import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { configureHttp } from '../../src/config/http.config';
import { CursosController } from '../../src/modules/cursos/cursos.controller';
import { CursosService } from '../../src/modules/cursos/cursos.service';
import { Curso } from '../../src/modules/cursos/entities/curso.entity';
import { Matricula } from '../../src/modules/matriculas/entities/matricula.entity';
import { TareasController } from '../../src/modules/tareas/tareas.controller';
import { TareasService } from '../../src/modules/tareas/tareas.service';
import { Tarea } from '../../src/modules/tareas/entities/tarea.entity';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { PublicUser } from '../../src/modules/auth/auth.types';
import { PdfStorageService } from '../../src/modules/files/pdf-storage.service';

const people: Record<string, PublicUser> = {
  teacher: { idUsuario: 1, nombres: 'Docente', apellidos: 'A', correo: 'a@example.test', rol: 'DOCENTE' },
  otherTeacher: { idUsuario: 4, nombres: 'Docente', apellidos: 'B', correo: 'b@example.test', rol: 'DOCENTE' },
  student: { idUsuario: 2, nombres: 'Alumno', apellidos: 'A', correo: 'c@example.test', rol: 'ALUMNO' },
  outsider: { idUsuario: 5, nombres: 'Alumno', apellidos: 'B', correo: 'd@example.test', rol: 'ALUMNO' },
};

describe('Cursos y tareas HTTP con repositorios simulados', () => {
  let app: INestApplication;
  let tasks: Tarea[];
  const courses = [
    { idCurso: 10, nombre: 'Matemática', codigo: 'MAT', idDocente: 1, estado: true },
    { idCurso: 20, nombre: 'Comunicación', codigo: 'COM', idDocente: 4, estado: true },
  ] as Curso[];

  beforeAll(async () => {
    const courseRepository = {
      find: jest.fn(async ({ where }: { where: { idDocente: number } }) => courses.filter((course) => course.idDocente === where.idDocente)),
      findOneBy: jest.fn(async ({ idCurso }: { idCurso: number }) => courses.find((course) => course.idCurso === idCurso) ?? null),
      createQueryBuilder: () => ({
        innerJoin() { return this; }, where() { return this; }, andWhere() { return this; }, orderBy() { return this; },
        getMany: async () => [courses[0]],
      }),
    };
    const enrollmentRepository = {
      existsBy: jest.fn(async ({ idCurso, idAlumno, estado }: { idCurso: number; idAlumno: number; estado: string }) =>
        idCurso === 10 && idAlumno === 2 && estado === 'ACTIVA'),
    };
    const taskRepository = {
      find: jest.fn(async ({ where }: { where: { idCurso: number; estado?: string } }) =>
        tasks.filter((task) => task.idCurso === where.idCurso && (!where.estado || task.estado === where.estado))),
      findOneBy: jest.fn(async ({ idTarea }: { idTarea: number }) => tasks.find((task) => task.idTarea === idTarea) ?? null),
      create: jest.fn((value: Tarea) => value),
      save: jest.fn(async (value: Tarea) => { value.idTarea = tasks.length + 1; tasks.push(value); return value; }),
    };
    const module = await Test.createTestingModule({
      controllers: [CursosController, TareasController],
      providers: [
        CursosService, TareasService, PdfStorageService,
        { provide: getRepositoryToken(Curso), useValue: courseRepository },
        { provide: getRepositoryToken(Matricula), useValue: enrollmentRepository },
        { provide: getRepositoryToken(Tarea), useValue: taskRepository },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: { switchToHttp: () => { getRequest: () => { headers: Record<string, string>; authUser?: PublicUser } } }) => {
        const req = context.switchToHttp().getRequest();
        const user = people[req.headers['x-test-user']];
        if (!user) throw new UnauthorizedException();
        req.authUser = user;
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, 'test');
    await app.init();
  });

  beforeEach(() => {
    tasks = [{ idTarea: 1, idCurso: 10, titulo: 'Borrador', descripcion: 'No visible',
      fechaPublicacion: new Date(), fechaLimite: new Date(Date.now() + 86400000),
      estado: 'BORRADOR', archivoReferencia: null } as Tarea];
  });
  afterAll(async () => { if (app) await app.close(); });

  it('exige sesión y filtra cursos por docente o matrícula activa', async () => {
    await request(app.getHttpServer()).get('/api/cursos').expect(401);
    const teacher = await request(app.getHttpServer()).get('/api/cursos').set('X-Test-User', 'teacher').expect(200);
    expect(teacher.body.map((course: { codigo: string }) => course.codigo)).toEqual(['MAT']);
    const student = await request(app.getHttpServer()).get('/api/cursos').set('X-Test-User', 'student').expect(200);
    expect(student.body.map((course: { codigo: string }) => course.codigo)).toEqual(['MAT']);
  });

  it('oculta tareas borrador y cursos ajenos al alumno', async () => {
    const teacher = await request(app.getHttpServer()).get('/api/cursos/10/tareas').set('X-Test-User', 'teacher').expect(200);
    expect(teacher.body).toHaveLength(1);
    const student = await request(app.getHttpServer()).get('/api/cursos/10/tareas').set('X-Test-User', 'student').expect(200);
    expect(student.body).toHaveLength(0);
    await request(app.getHttpServer()).get('/api/tareas/1').set('X-Test-User', 'student').expect(404);
    await request(app.getHttpServer()).get('/api/cursos/10/tareas').set('X-Test-User', 'outsider').expect(404);
    await request(app.getHttpServer()).get('/api/cursos/20/tareas').set('X-Test-User', 'teacher').expect(404);
  });

  it('publica solo el docente responsable y exige datos válidos sin autoría del cliente', async () => {
    const payload = { titulo: 'Nueva tarea', descripcion: 'Resolver ejercicios', fechaLimite: new Date(Date.now() + 86400000).toISOString() };
    await request(app.getHttpServer()).post('/api/cursos/10/tareas').set('X-Test-User', 'student').send(payload).expect(403);
    await request(app.getHttpServer()).post('/api/cursos/10/tareas').set('X-Test-User', 'otherTeacher').send(payload).expect(404);
    await request(app.getHttpServer()).post('/api/cursos/10/tareas').set('X-Test-User', 'teacher')
      .send({ ...payload, idDocente: 1 }).expect(400);
    await request(app.getHttpServer()).post('/api/cursos/10/tareas').set('X-Test-User', 'teacher')
      .send({ ...payload, fechaLimite: new Date(Date.now() - 1000).toISOString() }).expect(400);
    await request(app.getHttpServer()).post('/api/cursos/10/tareas').set('X-Test-User', 'teacher')
      .send({ ...payload, titulo: '' }).expect(400);
    const response = await request(app.getHttpServer()).post('/api/cursos/10/tareas')
      .set('X-Test-User', 'teacher').send(payload).expect(201);
    expect(response.body).toMatchObject({ titulo: 'Nueva tarea', estado: 'PUBLICADA', idCurso: 10 });
    const student = await request(app.getHttpServer()).get('/api/tareas/2').set('X-Test-User', 'student').expect(200);
    expect(student.body.titulo).toBe('Nueva tarea');
  });
});
