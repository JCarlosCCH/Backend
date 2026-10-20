import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PublicUser } from '../auth/auth.types';
import { PdfStorageService, PdfUpload } from '../files/pdf-storage.service';
import { TareasService } from '../tareas/tareas.service';
import { CreateEntregaDto } from './dto/create-entrega.dto';
import { CalificarEntregaDto } from './dto/calificar-entrega.dto';
import { Entrega } from './entities/entrega.entity';

export interface EntregaPublica {
  idEntrega: number;
  idTarea: number;
  idAlumno: number;
  comentario: string | null;
  fechaEntrega: string;
  estado: 'ENTREGADA' | 'REVISADA';
  nota: number | null;
  observacionDocente: string | null;
  tieneArchivo: true;
}

export interface EntregaListado extends EntregaPublica {
  nombresAlumno: string;
  apellidosAlumno: string;
}

@Injectable()
export class EntregasService {
  constructor(
    @InjectRepository(Entrega) private readonly entregas: Repository<Entrega>,
    private readonly tareas: TareasService,
    private readonly files: PdfStorageService,
  ) {}

  private async query<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch { throw new ServiceUnavailableException('Base de datos no disponible'); }
  }

  private publicDelivery(delivery: Entrega): EntregaPublica {
    return {
      idEntrega: delivery.idEntrega, idTarea: delivery.idTarea, idAlumno: delivery.idAlumno,
      comentario: delivery.comentario, fechaEntrega: delivery.fechaEntrega.toISOString(),
      estado: delivery.estado, nota: delivery.nota === null ? null : Number(delivery.nota),
      observacionDocente: delivery.observacionDocente, tieneArchivo: true,
    };
  }

  private uniqueViolation(error: unknown): boolean {
    const driver = error && typeof error === 'object' && 'driverError' in error ? error.driverError : error;
    if (driver && typeof driver === 'object' && 'code' in driver && driver.code === '23505') return true;
    return !!driver && typeof driver === 'object' && 'number' in driver &&
      (driver.number === 2601 || driver.number === 2627);
  }

  private currentTime(): Date { return new Date(); }

  async submit(idTarea: number, input: CreateEntregaDto, file: PdfUpload | undefined, user: PublicUser): Promise<EntregaPublica> {
    if (user.rol !== 'ALUMNO') throw new ForbiddenException('Solo un alumno puede registrar una entrega');
    const task = await this.tareas.accessible(idTarea, user);
    if (task.estado !== 'PUBLICADA') throw new ConflictException('La tarea no admite entregas');
    const now = this.currentTime();
    if (now.getTime() >= task.fechaLimite.getTime()) throw new ConflictException('El plazo de entrega terminó');
    this.files.validate(file);
    const existing = await this.query(() => this.entregas.existsBy({ idTarea, idAlumno: user.idUsuario }));
    if (existing) throw new ConflictException('Ya existe una entrega para esta tarea');
    const filename = await this.files.store(file, 'submission');
    const delivery = this.entregas.create({
      idTarea, idAlumno: user.idUsuario, archivoUrl: filename,
      comentario: input.comentario?.trim() || null, fechaEntrega: now,
      estado: 'ENTREGADA', nota: null, observacionDocente: null,
    });
    try { return this.publicDelivery(await this.entregas.save(delivery)); }
    catch (error) {
      await this.files.remove(filename);
      if (this.uniqueViolation(error)) throw new ConflictException('Ya existe una entrega para esta tarea');
      throw new ServiceUnavailableException('No se pudo registrar la entrega');
    }
  }

  async mine(idTarea: number, user: PublicUser): Promise<{ entrega: EntregaPublica | null }> {
    if (user.rol !== 'ALUMNO') throw new ForbiddenException('Solo un alumno puede consultar su entrega');
    await this.tareas.accessible(idTarea, user);
    const delivery = await this.query(() => this.entregas.findOneBy({ idTarea, idAlumno: user.idUsuario }));
    return { entrega: delivery ? this.publicDelivery(delivery) : null };
  }

  async list(idTarea: number, user: PublicUser): Promise<EntregaListado[]> {
    if (user.rol !== 'DOCENTE') throw new ForbiddenException('Solo el docente responsable puede consultar entregas');
    await this.tareas.accessible(idTarea, user);
    const deliveries = await this.query(() => this.entregas.find({
      where: { idTarea }, order: { fechaEntrega: 'ASC' },
      relations: { alumno: { usuario: true } },
      select: {
        idEntrega: true, idTarea: true, idAlumno: true, comentario: true,
        fechaEntrega: true, estado: true, nota: true, observacionDocente: true,
        alumno: { idAlumno: true, usuario: { idUsuario: true, nombres: true, apellidos: true } },
      },
    }));
    return deliveries.map((delivery) => ({
      ...this.publicDelivery(delivery),
      nombresAlumno: delivery.alumno.usuario.nombres,
      apellidosAlumno: delivery.alumno.usuario.apellidos,
    }));
  }

  async download(idEntrega: number, user: PublicUser): Promise<Buffer> {
    const delivery = await this.query(() => this.entregas.findOneBy({ idEntrega }));
    if (!delivery) throw new NotFoundException('Entrega no disponible');
    if (user.rol === 'DOCENTE') await this.tareas.accessible(delivery.idTarea, user);
    else if (delivery.idAlumno !== user.idUsuario) throw new NotFoundException('Entrega no disponible');
    return this.files.read(delivery.archivoUrl);
  }

  async grade(idEntrega: number, input: CalificarEntregaDto, user: PublicUser): Promise<EntregaPublica> {
    if (user.rol !== 'DOCENTE') throw new ForbiddenException('Solo el docente responsable puede calificar');
    const delivery = await this.query(() => this.entregas.findOneBy({ idEntrega }));
    if (!delivery) throw new NotFoundException('Entrega no disponible');
    await this.tareas.accessible(delivery.idTarea, user);
    const observacionDocente = input.observacionDocente?.trim() || null;
    await this.query(() => this.entregas.update({ idEntrega }, {
      nota: input.nota, observacionDocente, estado: 'REVISADA',
    }));
    return this.publicDelivery({ ...delivery, nota: input.nota, observacionDocente, estado: 'REVISADA' });
  }
}
