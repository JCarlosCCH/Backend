import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PublicUser } from '../../src/modules/auth/auth.types';
import { EntregasService } from '../../src/modules/entregas/entregas.service';
import { Entrega } from '../../src/modules/entregas/entities/entrega.entity';
import { PdfStorageService, PdfUpload } from '../../src/modules/files/pdf-storage.service';
import { Tarea } from '../../src/modules/tareas/entities/tarea.entity';
import { TareasService } from '../../src/modules/tareas/tareas.service';
import { PDF_MAX_BYTES } from '../../src/config/file.config';

const student: PublicUser = { idUsuario: 2, nombres: 'Alumno', apellidos: 'Prueba', correo: 'a@example.test', rol: 'ALUMNO' };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const upload: PdfUpload = { originalname: 'trabajo.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf };

describe('PDF del piloto', () => {
  const storage = new PdfStorageService();

  it('acepta un PDF no vacío con firma y final esperados', () => {
    expect(() => storage.validate(upload)).not.toThrow();
  });

  it.each([
    { candidate: undefined, label: 'ausente' },
    { candidate: { ...upload, size: 0, buffer: Buffer.alloc(0) }, label: 'vacío' },
    { candidate: { ...upload, mimetype: 'image/png' }, label: 'MIME' },
    { candidate: { ...upload, originalname: '../trabajo.pdf' }, label: 'ruta' },
    { candidate: { ...upload, originalname: 'trabajo.txt' }, label: 'extensión' },
    { candidate: { ...upload, buffer: Buffer.from('falso %%EOF') }, label: 'contenido' },
    { candidate: { ...upload, size: PDF_MAX_BYTES + 1 }, label: 'tamaño' },
  ])('rechaza PDF $label', ({ candidate }) => {
    expect(() => storage.validate(candidate as PdfUpload | undefined)).toThrow();
  });
});

describe('Entrega y plazo', () => {
  let service: EntregasService;
  let task: Tarea;
  let repository: { existsBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let storage: PdfStorageService;
  const now = new Date('2026-09-23T15:00:00.000Z');

  beforeEach(() => {
    task = { idTarea: 10, idCurso: 7, estado: 'PUBLICADA', fechaLimite: new Date(now.getTime() + 1) } as Tarea;
    repository = {
      existsBy: jest.fn().mockResolvedValue(false),
      create: jest.fn((value: Entrega) => value),
      save: jest.fn(async (value: Entrega) => ({ ...value, idEntrega: 31 })),
    };
    storage = new PdfStorageService();
    jest.spyOn(storage, 'store').mockResolvedValue('submission-00000000-0000-0000-0000-000000000001.pdf');
    jest.spyOn(storage, 'remove').mockResolvedValue();
    const tasks = { accessible: jest.fn().mockResolvedValue(task) } as unknown as TareasService;
    service = new EntregasService(repository as unknown as Repository<Entrega>, tasks, storage);
    jest.spyOn(service as unknown as { currentTime: () => Date }, 'currentTime').mockReturnValue(now);
  });

  it('acepta antes del límite y toma alumno, fecha y estado del servidor', async () => {
    const result = await service.submit(10, {}, upload, student);
    expect(result).toMatchObject({ idAlumno: 2, idTarea: 10, estado: 'ENTREGADA', nota: null });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      idAlumno: 2, fechaEntrega: now, estado: 'ENTREGADA', nota: null,
    }));
  });

  it.each([0, -1])('rechaza exactamente en el límite o después (%i ms)', async (offset) => {
    task.fechaLimite = new Date(now.getTime() + offset);
    await expect(service.submit(10, {}, upload, student)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('rechaza una entrega previa', async () => {
    repository.existsBy.mockResolvedValue(true);
    await expect(service.submit(10, {}, upload, student)).rejects.toBeInstanceOf(ConflictException);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it.each([{ number: 2627 }, { code: '23505' }])('convierte una colisión UNIQUE concurrente en 409 y limpia el archivo perdedor (%j)', async (driverError) => {
    let saves = 0;
    repository.save.mockImplementation(async (value: Entrega) => {
      saves += 1;
      if (saves === 2) throw { driverError };
      return { ...value, idEntrega: 31 };
    });
    const results = await Promise.allSettled([
      service.submit(10, {}, upload, student), service.submit(10, {}, upload, student),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });
});
