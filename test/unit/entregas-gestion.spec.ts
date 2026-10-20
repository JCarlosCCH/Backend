import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PublicUser } from '../../src/modules/auth/auth.types';
import { Entrega } from '../../src/modules/entregas/entities/entrega.entity';
import { EntregasService } from '../../src/modules/entregas/entregas.service';
import { PdfStorageService } from '../../src/modules/files/pdf-storage.service';
import { TareasService } from '../../src/modules/tareas/tareas.service';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const teacher: PublicUser = { idUsuario: 1, nombres: 'Docente', apellidos: 'Prueba', correo: 'docente@example.test', rol: 'DOCENTE' };
const enrolledStudent: PublicUser = { idUsuario: 2, nombres: 'Alumno', apellidos: 'Prueba', correo: 'alumno@example.test', rol: 'ALUMNO' };
const otherStudent: PublicUser = { idUsuario: 77, nombres: 'Mateo', apellidos: 'Prueba', correo: 'mateo@example.test', rol: 'ALUMNO' };
const ownerStudent: PublicUser = { idUsuario: 42, nombres: 'Camila', apellidos: 'Prueba', correo: 'camila@example.test', rol: 'ALUMNO' };

const delivery: Entrega = {
  idEntrega: 53, idTarea: 80, idAlumno: 42, comentario: null,
  fechaEntrega: new Date('2026-09-23T15:00:00.000Z'), estado: 'ENTREGADA',
  nota: null, observacionDocente: null, archivoUrl: 'submission-00000000-0000-0000-0000-000000000003.pdf',
} as Entrega;

describe('Gestión de entregas: consulta, descarga y calificación', () => {
  let repository: { findOneBy: jest.Mock; update: jest.Mock };
  let tareas: { accessible: jest.Mock };
  let files: PdfStorageService;
  let service: EntregasService;

  beforeEach(() => {
    repository = {
      findOneBy: jest.fn(async (where: Record<string, unknown>) => {
        if (where.idEntrega !== undefined) return where.idEntrega === 53 ? { ...delivery } : null;
        if (where.idTarea !== undefined && where.idAlumno !== undefined) {
          return where.idTarea === 80 && where.idAlumno === 2 ? { ...delivery, idAlumno: 2 } : null;
        }
        return null;
      }),
      update: jest.fn(async () => undefined),
    };
    tareas = { accessible: jest.fn(async () => ({})) };
    files = new PdfStorageService();
    jest.spyOn(files, 'read').mockResolvedValue(pdf);
    service = new EntregasService(
      repository as unknown as Repository<Entrega>,
      tareas as unknown as TareasService,
      files,
    );
  });

  it('mine rechaza al docente con 403', async () => {
    await expect(service.mine(80, teacher)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findOneBy).not.toHaveBeenCalled();
  });

  it('mine devuelve null cuando el alumno no tiene entrega', async () => {
    await expect(service.mine(80, otherStudent)).resolves.toEqual({ entrega: null });
  });

  it('mine devuelve la entrega propia sin exponer la ruta del archivo', async () => {
    const result = await service.mine(80, enrolledStudent);
    expect(result.entrega).toMatchObject({ idTarea: 80, idAlumno: 2, tieneArchivo: true });
    expect(JSON.stringify(result)).not.toContain('archivoUrl');
  });

  it('download oculta al alumno ajeno con 404', async () => {
    await expect(service.download(53, enrolledStudent)).rejects.toBeInstanceOf(NotFoundException);
    expect(files.read).not.toHaveBeenCalled();
  });

  it('download permite al alumno propietario leer su archivo', async () => {
    await expect(service.download(53, ownerStudent)).resolves.toBe(pdf);
  });

  it('download permite al docente del curso leer cualquier entrega', async () => {
    await expect(service.download(53, teacher)).resolves.toBe(pdf);
    expect(tareas.accessible).toHaveBeenCalledWith(80, teacher);
  });

  it('download oculta al docente ajeno con 404', async () => {
    tareas.accessible.mockRejectedValueOnce(new NotFoundException('Tarea no disponible'));
    await expect(service.download(53, teacher)).rejects.toBeInstanceOf(NotFoundException);
    expect(files.read).not.toHaveBeenCalled();
  });

  it('grade rechaza al alumno con 403', async () => {
    await expect(service.grade(53, { nota: 12 }, ownerStudent)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('grade rechaza una entrega inexistente con 404', async () => {
    await expect(service.grade(99, { nota: 12 }, teacher)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('grade exige ser el docente del curso de la tarea', async () => {
    tareas.accessible.mockRejectedValueOnce(new NotFoundException('Tarea no disponible'));
    await expect(service.grade(53, { nota: 12 }, teacher)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('grade registra nota 0 con estado REVISADA y observación nula', async () => {
    const result = await service.grade(53, { nota: 0 }, teacher);
    expect(result).toMatchObject({ nota: 0, estado: 'REVISADA', observacionDocente: null });
    expect(result.nota).toBe(0);
    expect(repository.update).toHaveBeenCalledWith(
      { idEntrega: 53 },
      { nota: 0, observacionDocente: null, estado: 'REVISADA' },
    );
  });

  it('grade acepta la nota máxima 20 y recorta la observación', async () => {
    const result = await service.grade(53, { nota: 20, observacionDocente: '  Revisión completa  ' }, teacher);
    expect(result).toMatchObject({ nota: 20, estado: 'REVISADA', observacionDocente: 'Revisión completa' });
  });

  it('grade distingue la nota nula previa de la nota 0 asignada', async () => {
    expect(delivery.nota).toBeNull();
    const result = await service.grade(53, { nota: 0 }, teacher);
    expect(result.nota).not.toBeNull();
    expect(result.nota).toBe(0);
  });
});
