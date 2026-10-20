import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PublicUser } from '../../src/modules/auth/auth.types';
import { CursosService } from '../../src/modules/cursos/cursos.service';
import { Curso } from '../../src/modules/cursos/entities/curso.entity';
import { Matricula } from '../../src/modules/matriculas/entities/matricula.entity';

const teacher: PublicUser = { idUsuario: 1, nombres: 'Docente', apellidos: 'Prueba', correo: 'docente@example.test', rol: 'DOCENTE' };
const student: PublicUser = { idUsuario: 2, nombres: 'Alumno', apellidos: 'Prueba', correo: 'alumno@example.test', rol: 'ALUMNO' };
const courses = [
  { idCurso: 10, nombre: 'Matemática', codigo: 'PRU4A-MAT', idDocente: 1, estado: true },
  { idCurso: 20, nombre: 'Comunicación', codigo: 'PRU4A-COM', idDocente: 4, estado: true },
  { idCurso: 30, nombre: 'Archivo', codigo: 'PRU4A-INA', idDocente: 1, estado: false },
] as Curso[];

describe('Cursos: visibilidad y acceso por rol', () => {
  let cursos: { find: jest.Mock; findOneBy: jest.Mock; createQueryBuilder: jest.Mock };
  let matriculas: { existsBy: jest.Mock };
  let service: CursosService;

  beforeEach(() => {
    cursos = {
      find: jest.fn(async ({ where }: { where: { idDocente: number; estado: boolean } }) =>
        courses.filter((course) => course.idDocente === where.idDocente && course.estado === where.estado)),
      findOneBy: jest.fn(async ({ idCurso, estado }: { idCurso: number; estado: boolean }) =>
        courses.find((course) => course.idCurso === idCurso && course.estado === estado) ?? null),
      createQueryBuilder: jest.fn(() => ({
        innerJoin() { return this; },
        where() { return this; },
        andWhere() { return this; },
        orderBy() { return this; },
        getMany: async () => [courses[0]],
      })),
    };
    matriculas = {
      existsBy: jest.fn(async ({ idCurso, idAlumno, estado }: { idCurso: number; idAlumno: number; estado: string }) =>
        idCurso === 10 && idAlumno === 2 && estado === 'ACTIVA'),
    };
    service = new CursosService(
      cursos as unknown as Repository<Curso>,
      matriculas as unknown as Repository<Matricula>,
    );
  });

  it('el docente solo ve sus cursos activos', async () => {
    const result = await service.list(teacher);
    expect(result).toEqual([{ idCurso: 10, nombre: 'Matemática', codigo: 'PRU4A-MAT' }]);
    expect(cursos.find).toHaveBeenCalledWith(expect.objectContaining({ where: { idDocente: 1, estado: true } }));
  });

  it('el alumno solo ve cursos con matrícula ACTIVA', async () => {
    const result = await service.list(student);
    expect(result).toEqual([{ idCurso: 10, nombre: 'Matemática', codigo: 'PRU4A-MAT' }]);
    expect(cursos.createQueryBuilder).toHaveBeenCalled();
  });

  it('permite el acceso al docente propietario', async () => {
    await expect(service.accessible(10, teacher)).resolves.toMatchObject({ idCurso: 10, idDocente: 1 });
  });

  it('oculta al docente ajeno con 404', async () => {
    await expect(service.accessible(20, teacher)).rejects.toBeInstanceOf(NotFoundException);
    expect(matriculas.existsBy).not.toHaveBeenCalled();
  });

  it('oculta el curso inactivo aunque el docente sea propietario', async () => {
    await expect(service.accessible(30, teacher)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('permite el acceso al alumno con matrícula ACTIVA', async () => {
    await expect(service.accessible(10, student)).resolves.toMatchObject({ idCurso: 10 });
    expect(matriculas.existsBy).toHaveBeenCalledWith({ idCurso: 10, idAlumno: 2, estado: 'ACTIVA' });
  });

  it('oculta al alumno sin matrícula activa con 404', async () => {
    await expect(service.accessible(20, student)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('owned rechaza al alumno con 403 sin tocar matrículas', async () => {
    await expect(service.owned(10, student)).rejects.toBeInstanceOf(ForbiddenException);
    expect(matriculas.existsBy).not.toHaveBeenCalled();
  });

  it('owned devuelve el curso al docente propietario', async () => {
    await expect(service.owned(10, teacher)).resolves.toMatchObject({ idCurso: 10 });
  });
});
