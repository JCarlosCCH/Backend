import { INestApplication, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { configureHttp } from '../../src/config/http.config';
import { PublicUser } from '../../src/modules/auth/auth.types';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { EntregasController } from '../../src/modules/entregas/entregas.controller';
import { EntregasService } from '../../src/modules/entregas/entregas.service';
import { Entrega } from '../../src/modules/entregas/entities/entrega.entity';
import { PdfStorageService } from '../../src/modules/files/pdf-storage.service';
import { Tarea } from '../../src/modules/tareas/entities/tarea.entity';
import { TareasService } from '../../src/modules/tareas/tareas.service';
import { PDF_MAX_BYTES } from '../../src/config/file.config';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const people: Record<string, PublicUser> = {
  teacher: { idUsuario: 1, nombres: 'Docente', apellidos: 'A', correo: 'a@example.test', rol: 'DOCENTE' },
  student: { idUsuario: 2, nombres: 'Alumno', apellidos: 'A', correo: 'b@example.test', rol: 'ALUMNO' },
  outsider: { idUsuario: 5, nombres: 'Alumno', apellidos: 'B', correo: 'c@example.test', rol: 'ALUMNO' },
  otherteacher: { idUsuario: 6, nombres: 'Docente', apellidos: 'B', correo: 'd@example.test', rol: 'DOCENTE' },
};

describe('Entrega HTTP multipart con dobles de repositorio y almacenamiento', () => {
  let app: INestApplication;
  let deliveries: Entrega[];

  beforeAll(async () => {
    const storage = new PdfStorageService();
    jest.spyOn(storage, 'store').mockResolvedValue('submission-00000000-0000-0000-0000-000000000001.pdf');
    jest.spyOn(storage, 'read').mockResolvedValue(pdf);
    jest.spyOn(storage, 'remove').mockResolvedValue();
    const task = { idTarea: 10, idCurso: 7, estado: 'PUBLICADA', fechaLimite: new Date(Date.now() + 86400000) } as Tarea;
    const tasks = { accessible: jest.fn(async (_id: number, user: PublicUser) => {
      if (user.idUsuario === 5 || user.idUsuario === 6) throw new NotFoundException('Tarea no disponible');
      return task;
    }) };
    const repository = {
      existsBy: jest.fn(async ({ idTarea, idAlumno }: { idTarea: number; idAlumno: number }) =>
        deliveries.some((delivery) => delivery.idTarea === idTarea && delivery.idAlumno === idAlumno)),
      create: jest.fn((value: Entrega) => value),
      save: jest.fn(async (value: Entrega) => { const saved = { ...value, idEntrega: deliveries.length + 1 }; deliveries.push(saved); return saved; }),
      findOneBy: jest.fn(async (where: { idEntrega?: number; idTarea?: number; idAlumno?: number }) =>
        deliveries.find((delivery) => Object.entries(where).every(([key, value]) => delivery[key as keyof Entrega] === value)) ?? null),
      find: jest.fn(async ({ where }: { where: { idTarea: number } }) => deliveries.filter((delivery) => delivery.idTarea === where.idTarea)
        .map((delivery) => ({ ...delivery, alumno: { idAlumno: delivery.idAlumno, usuario: { nombres: 'Camila Valentina', apellidos: 'Soto Ramírez' } } }))),
      update: jest.fn(async ({ idEntrega }: { idEntrega: number }, changes: Partial<Entrega>) => {
        const index = deliveries.findIndex((delivery) => delivery.idEntrega === idEntrega);
        deliveries[index] = { ...deliveries[index], ...changes };
      }),
    };
    const module = await Test.createTestingModule({
      controllers: [EntregasController],
      providers: [
        EntregasService,
        { provide: TareasService, useValue: tasks },
        { provide: PdfStorageService, useValue: storage },
        { provide: getRepositoryToken(Entrega), useValue: repository },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: { switchToHttp: () => { getRequest: () => { headers: Record<string, string>; authUser?: PublicUser } } }) => {
      const req = context.switchToHttp().getRequest();
      const user = people[req.headers['x-test-user']];
      if (!user) throw new UnauthorizedException();
      req.authUser = user;
      return true;
    } }).compile();
    app = module.createNestApplication();
    configureHttp(app, 'test');
    await app.init();
  });
  beforeEach(() => { deliveries = []; });
  afterAll(async () => { if (app) await app.close(); });

  const post = (user: string) => request(app.getHttpServer()).post('/api/tareas/10/entregas').set('X-Test-User', user);

  it('recibe un PDF real en multipart, consulta la entrega y obliga a descargarlo', async () => {
    const response = await post('student').field('comentario', 'Trabajo terminado')
      .attach('archivo', pdf, { filename: 'trabajo.pdf', contentType: 'application/pdf' }).expect(201);
    expect(response.body).toMatchObject({ idAlumno: 2, estado: 'ENTREGADA', nota: null });
    expect(response.body).not.toHaveProperty('archivoUrl');
    const mine = await request(app.getHttpServer()).get('/api/tareas/10/mi-entrega').set('X-Test-User', 'student').expect(200);
    expect(mine.body.entrega.idEntrega).toBe(response.body.idEntrega);
    const download = await request(app.getHttpServer()).get(`/api/entregas/${response.body.idEntrega}/archivo`)
      .set('X-Test-User', 'teacher').expect(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    await request(app.getHttpServer()).get(`/api/entregas/${response.body.idEntrega}/archivo`)
      .set('X-Test-User', 'outsider').expect(404);
  });

  it('rechaza rol ajeno, alumno retirado y campos de autoría', async () => {
    await post('teacher').attach('archivo', pdf, { filename: 'trabajo.pdf', contentType: 'application/pdf' }).expect(403);
    await post('outsider').attach('archivo', pdf, { filename: 'trabajo.pdf', contentType: 'application/pdf' }).expect(404);
    await post('student').field('idAlumno', '5')
      .attach('archivo', pdf, { filename: 'trabajo.pdf', contentType: 'application/pdf' }).expect(400);
  });

  it('rechaza archivo ausente, vacío, tipo falso y límite de tamaño', async () => {
    await post('student').field('comentario', 'sin archivo').expect(400);
    await post('student').attach('archivo', Buffer.alloc(0), { filename: 'vacío.pdf', contentType: 'application/pdf' }).expect(400);
    await post('student').attach('archivo', Buffer.from('falso'), { filename: 'falso.pdf', contentType: 'application/pdf' }).expect(400);
    await post('student').attach('archivo', pdf, { filename: 'imagen.png', contentType: 'image/png' }).expect(400);
    await post('student').attach('archivo', Buffer.alloc(PDF_MAX_BYTES + 1), { filename: 'grande.pdf', contentType: 'application/pdf' }).expect(413);
  });

  it('rechaza una segunda entrega con 409', async () => {
    await post('student').attach('archivo', pdf, { filename: 'trabajo.pdf', contentType: 'application/pdf' }).expect(201);
    await post('student').attach('archivo', pdf, { filename: 'trabajo.pdf', contentType: 'application/pdf' }).expect(409);
  });

  it('lista nombres para el docente responsable sin abrir el acceso a otras identidades', async () => {
    const created = await post('student').attach('archivo', pdf, { filename: 'trabajo.pdf', contentType: 'application/pdf' }).expect(201);
    const path = '/api/tareas/10/entregas';
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).set('X-Test-User', 'student').expect(403);
    await request(app.getHttpServer()).get(path).set('X-Test-User', 'otherteacher').expect(404);
    const response = await request(app.getHttpServer()).get(path).set('X-Test-User', 'teacher').expect(200);
    expect(response.body).toEqual([{ ...created.body, nombresAlumno: 'Camila Valentina', apellidosAlumno: 'Soto Ramírez' }]);
    expect(Object.keys(response.body[0]).sort()).toEqual([
      'idEntrega', 'idTarea', 'idAlumno', 'comentario', 'fechaEntrega', 'estado', 'nota', 'observacionDocente', 'tieneArchivo', 'nombresAlumno', 'apellidosAlumno',
    ].sort());
  });

  it('califica con cero y el alumno ve su propio resultado', async () => {
    const created = await post('student').attach('archivo', pdf, { filename: 'trabajo.pdf', contentType: 'application/pdf' }).expect(201);
    const path = `/api/entregas/${created.body.idEntrega}/calificacion`;
    await request(app.getHttpServer()).patch(path).send({ nota: 0 }).expect(401);
    await request(app.getHttpServer()).patch(path).set('X-Test-User', 'student').send({ nota: 0 }).expect(403);
    await request(app.getHttpServer()).patch(path).set('X-Test-User', 'otherteacher').send({ nota: 0 }).expect(404);
    await request(app.getHttpServer()).patch(path).set('X-Test-User', 'teacher').send({ nota: -1 }).expect(400);
    await request(app.getHttpServer()).patch(path).set('X-Test-User', 'teacher').send({ nota: 20.001 }).expect(400);
    await request(app.getHttpServer()).patch(path).set('X-Test-User', 'teacher').send({ nota: 21 }).expect(400);
    await request(app.getHttpServer()).patch(path).set('X-Test-User', 'teacher').send({ nota: 0, observacionDocente: 'x'.repeat(501) }).expect(400);
    const graded = await request(app.getHttpServer()).patch(path).set('X-Test-User', 'teacher')
      .send({ nota: 0, observacionDocente: 'Revisado' }).expect(200);
    expect(graded.body).toMatchObject({ nota: 0, estado: 'REVISADA', observacionDocente: 'Revisado' });
    const mine = await request(app.getHttpServer()).get('/api/tareas/10/mi-entrega').set('X-Test-User', 'student').expect(200);
    expect(mine.body.entrega).toMatchObject({ nota: 0, estado: 'REVISADA' });
  });
});
