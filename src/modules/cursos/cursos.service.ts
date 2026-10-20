import { Injectable, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicUser } from '../auth/auth.types';
import { Matricula } from '../matriculas/entities/matricula.entity';
import { Curso } from './entities/curso.entity';

export interface CursoPublico {
  idCurso: number;
  nombre: string;
  codigo: string;
}

@Injectable()
export class CursosService {
  constructor(
    @InjectRepository(Curso) private readonly cursos: Repository<Curso>,
    @InjectRepository(Matricula) private readonly matriculas: Repository<Matricula>,
  ) {}

  private async query<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch { throw new ServiceUnavailableException('Base de datos no disponible'); }
  }

  private publicCourse(course: Curso): CursoPublico {
    return { idCurso: course.idCurso, nombre: course.nombre, codigo: course.codigo };
  }

  async list(user: PublicUser): Promise<CursoPublico[]> {
    const courses = user.rol === 'DOCENTE'
      ? await this.query(() => this.cursos.find({ where: { idDocente: user.idUsuario, estado: true }, order: { nombre: 'ASC' } }))
      : await this.query(() => this.cursos.createQueryBuilder('curso')
        .innerJoin(Matricula, 'matricula', 'matricula.idCurso = curso.idCurso')
        .where('curso.estado = :activo', { activo: true })
        .andWhere('matricula.idAlumno = :alumno', { alumno: user.idUsuario })
        .andWhere('matricula.estado = :estado', { estado: 'ACTIVA' })
        .orderBy('curso.nombre', 'ASC').getMany());
    return courses.map((course) => this.publicCourse(course));
  }

  async accessible(idCurso: number, user: PublicUser): Promise<Curso> {
    const course = await this.query(() => this.cursos.findOneBy({ idCurso, estado: true }));
    if (!course) throw new NotFoundException('Curso no disponible');
    if (user.rol === 'DOCENTE') {
      if (course.idDocente !== user.idUsuario) throw new NotFoundException('Curso no disponible');
    } else {
      const enrolled = await this.query(() => this.matriculas.existsBy({
        idCurso, idAlumno: user.idUsuario, estado: 'ACTIVA',
      }));
      if (!enrolled) throw new NotFoundException('Curso no disponible');
    }
    return course;
  }

  async owned(idCurso: number, user: PublicUser): Promise<Curso> {
    if (user.rol !== 'DOCENTE') throw new ForbiddenException('Solo un docente puede publicar tareas');
    return this.accessible(idCurso, user);
  }
}
