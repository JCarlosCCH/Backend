import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicUser } from '../auth/auth.types';
import { CursosService } from '../cursos/cursos.service';
import { PdfStorageService, PdfUpload } from '../files/pdf-storage.service';
import { CreateTareaDto } from './dto/create-tarea.dto';
import { Tarea } from './entities/tarea.entity';

export interface TareaPublica {
  idTarea: number;
  idCurso: number;
  titulo: string;
  descripcion: string;
  fechaPublicacion: string;
  fechaLimite: string;
  estado: 'BORRADOR' | 'PUBLICADA' | 'CERRADA';
  tieneArchivoReferencia: boolean;
}

@Injectable()
export class TareasService {
  constructor(
    @InjectRepository(Tarea) private readonly tareas: Repository<Tarea>,
    private readonly cursos: CursosService,
    private readonly files: PdfStorageService,
  ) {}

  private async query<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch { throw new ServiceUnavailableException('Base de datos no disponible'); }
  }

  publicTask(task: Tarea): TareaPublica {
    return {
      idTarea: task.idTarea, idCurso: task.idCurso, titulo: task.titulo,
      descripcion: task.descripcion, fechaPublicacion: task.fechaPublicacion.toISOString(),
      fechaLimite: task.fechaLimite.toISOString(), estado: task.estado,
      tieneArchivoReferencia: !!task.archivoReferencia,
    };
  }

  async list(idCurso: number, user: PublicUser): Promise<TareaPublica[]> {
    await this.cursos.accessible(idCurso, user);
    const tasks = await this.query(() => this.tareas.find({
      where: user.rol === 'ALUMNO' ? { idCurso, estado: 'PUBLICADA' } : { idCurso },
      order: { fechaPublicacion: 'DESC' },
    }));
    return tasks.map((task) => this.publicTask(task));
  }

  async accessible(idTarea: number, user: PublicUser): Promise<Tarea> {
    const task = await this.query(() => this.tareas.findOneBy({ idTarea }));
    if (!task) throw new NotFoundException('Tarea no disponible');
    await this.cursos.accessible(task.idCurso, user);
    if (user.rol === 'ALUMNO' && task.estado !== 'PUBLICADA') {
      throw new NotFoundException('Tarea no disponible');
    }
    return task;
  }

  async detail(idTarea: number, user: PublicUser): Promise<TareaPublica> {
    return this.publicTask(await this.accessible(idTarea, user));
  }

  async create(idCurso: number, input: CreateTareaDto, user: PublicUser, file?: PdfUpload): Promise<TareaPublica> {
    await this.cursos.owned(idCurso, user);
    const fechaPublicacion = new Date();
    const fechaLimite = new Date(input.fechaLimite);
    if (Number.isNaN(fechaLimite.getTime()) || fechaLimite <= fechaPublicacion ||
      !input.titulo.trim() || !input.descripcion.trim()) {
      throw new BadRequestException('Título, descripción y fecha límite válidos son obligatorios');
    }
    const reference = file ? await this.files.store(file, 'task') : null;
    const task = this.tareas.create({
      idCurso, titulo: input.titulo.trim(), descripcion: input.descripcion.trim(),
      archivoReferencia: reference, fechaPublicacion, fechaLimite, estado: 'PUBLICADA',
    });
    try { return this.publicTask(await this.query(() => this.tareas.save(task))); }
    catch (error) {
      if (reference) await this.files.remove(reference);
      throw error;
    }
  }

  async referenceFile(idTarea: number, user: PublicUser): Promise<Buffer> {
    const task = await this.accessible(idTarea, user);
    if (!task.archivoReferencia) throw new NotFoundException('La tarea no tiene archivo de referencia');
    return this.files.read(task.archivoReferencia);
  }
}
