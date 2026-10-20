import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PublicUser } from '../../src/modules/auth/auth.types';
import { CursosService } from '../../src/modules/cursos/cursos.service';
import { PdfStorageService, PdfUpload } from '../../src/modules/files/pdf-storage.service';
import { Tarea } from '../../src/modules/tareas/entities/tarea.entity';
import { TareasService } from '../../src/modules/tareas/tareas.service';

const teacher: PublicUser = { idUsuario: 1, nombres: 'Docente', apellidos: 'Prueba', correo: 'docente@example.test', rol: 'DOCENTE' };
const student: PublicUser = { idUsuario: 2, nombres: 'Alumno', apellidos: 'Prueba', correo: 'alumno@example.test', rol: 'ALUMNO' };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
const upload: PdfUpload = { originalname: 'guia.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf };

describe('Publicación y consulta de tareas', () => {
  let repository: { find: jest.Mock; findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let cursos: { accessible: jest.Mock; owned: jest.Mock };
  let files: PdfStorageService;
  let service: TareasService;

  const input = () => ({
    titulo: '  Resolvemos problemas  ',
    descripcion: ' Ejercicios de práctica ',
    fechaLimite: new Date(Date.now() + 86_400_000).toISOString(),
  });

  beforeEach(() => {
    repository = {
      find: jest.fn(async () => []),
      findOneBy: jest.fn(async () => null),
      create: jest.fn((value: Tarea) => value),
      save: jest.fn(async (value: Tarea) => ({ ...value, idTarea: 9 })),
    };
    cursos = { accessible: jest.fn(async () => ({})), owned: jest.fn(async () => ({})) };
    files = new PdfStorageService();
    jest.spyOn(files, 'store').mockResolvedValue('task-00000000-0000-0000-0000-000000000002.pdf');
    jest.spyOn(files, 'remove').mockResolvedValue();
    jest.spyOn(files, 'read').mockResolvedValue(pdf);
    service = new TareasService(
      repository as unknown as Repository<Tarea>,
      cursos as unknown as CursosService,
      files,
    );
  });

  it('el docente responsable publica con texto recortado y estado PUBLICADA', async () => {
    const result = await service.create(10, input(), teacher);
    expect(cursos.owned).toHaveBeenCalledWith(10, teacher);
    expect(result).toMatchObject({
      idCurso: 10, titulo: 'Resolvemos problemas', descripcion: 'Ejercicios de práctica', estado: 'PUBLICADA',
    });
  });

  it('guarda el PDF de referencia y lo anuncia en la respuesta', async () => {
    const result = await service.create(10, input(), teacher, upload);
    expect(files.store).toHaveBeenCalledWith(upload, 'task');
    expect(result.tieneArchivoReferencia).toBe(true);
  });

  it.each([
    { label: 'fecha límite pasada', payload: () => ({ ...input(), fechaLimite: new Date(Date.now() - 1_000).toISOString() }) },
    { label: 'fecha límite ilegible', payload: () => ({ ...input(), fechaLimite: 'no-es-una-fecha' }) },
    { label: 'título en blanco', payload: () => ({ ...input(), titulo: '   ' }) },
    { label: 'descripción en blanco', payload: () => ({ ...input(), descripcion: '' }) },
  ])('rechaza $label antes de tocar archivos o base', async ({ payload }) => {
    await expect(service.create(10, payload(), teacher)).rejects.toBeInstanceOf(BadRequestException);
    expect(files.store).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('limpia el archivo guardado si la base falla y responde 503', async () => {
    repository.save.mockRejectedValueOnce(new Error('detalle privado SQL'));
    await expect(service.create(10, input(), teacher, upload)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(files.remove).toHaveBeenCalledWith('task-00000000-0000-0000-0000-000000000002.pdf');
  });

  it('lista al alumno solo tareas PUBLICADA', async () => {
    await service.list(10, student);
    expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: { idCurso: 10, estado: 'PUBLICADA' },
    }));
  });

  it('lista al docente todas las tareas del curso', async () => {
    await service.list(10, teacher);
    expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({
      where: { idCurso: 10 },
    }));
  });

  it('accessible oculta un borrador al alumno con 404', async () => {
    repository.findOneBy.mockResolvedValueOnce({ idTarea: 3, idCurso: 10, estado: 'BORRADOR' } as Tarea);
    await expect(service.accessible(3, student)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accessible permite el borrador al docente del curso', async () => {
    repository.findOneBy.mockResolvedValueOnce({ idTarea: 3, idCurso: 10, estado: 'BORRADOR' } as Tarea);
    await expect(service.accessible(3, teacher)).resolves.toMatchObject({ idTarea: 3 });
  });

  it('referenceFile exige que la tarea tenga archivo', async () => {
    repository.findOneBy.mockResolvedValueOnce({ idTarea: 3, idCurso: 10, archivoReferencia: null } as Tarea);
    await expect(service.referenceFile(3, teacher)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('referenceFile devuelve el contenido almacenado', async () => {
    repository.findOneBy.mockResolvedValueOnce({
      idTarea: 3, idCurso: 10, archivoReferencia: 'task-00000000-0000-0000-0000-000000000002.pdf',
    } as Tarea);
    await expect(service.referenceFile(3, teacher)).resolves.toBe(pdf);
  });
});
