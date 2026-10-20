import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { EntregasService } from '../../src/modules/entregas/entregas.service';
import { Entrega } from '../../src/modules/entregas/entities/entrega.entity';
import { TareasService } from '../../src/modules/tareas/tareas.service';
import { PdfStorageService } from '../../src/modules/files/pdf-storage.service';
import { PublicUser } from '../../src/modules/auth/auth.types';

describe('Nombres del alumno en el listado autorizado', () => {
  const teacher: PublicUser = { idUsuario: 31, nombres: 'Diego Alonso', apellidos: 'Rojas Salcedo', correo: 'docente@example.test', rol: 'DOCENTE' };
  const find = jest.fn();
  const accessible = jest.fn();
  const service = new EntregasService({ find } as unknown as Repository<Entrega>,
    { accessible } as unknown as TareasService, {} as PdfStorageService);
  beforeEach(() => { jest.resetAllMocks(); accessible.mockResolvedValue({ idTarea: 80 }); });

  it('consulta las relaciones de una vez, conserva los campos y solo añade nombres y apellidos', async () => {
    find.mockResolvedValue([{
      idEntrega: 53, idTarea: 80, idAlumno: 42, comentario: 'Mi trabajo', fechaEntrega: new Date('2026-09-23T15:00:00Z'),
      estado: 'REVISADA', nota: 0, observacionDocente: 'Revisado',
      alumno: { idAlumno: 42, usuario: { idUsuario: 42, nombres: 'Camila Valentina', apellidos: 'Soto Ramírez' } },
    }]);
    await expect(service.list(80, teacher)).resolves.toEqual([{
      idEntrega: 53, idTarea: 80, idAlumno: 42, comentario: 'Mi trabajo', fechaEntrega: '2026-09-23T15:00:00.000Z',
      estado: 'REVISADA', nota: 0, observacionDocente: 'Revisado', tieneArchivo: true,
      nombresAlumno: 'Camila Valentina', apellidosAlumno: 'Soto Ramírez',
    }]);
    expect(accessible).toHaveBeenCalledWith(80, teacher);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      where: { idTarea: 80 }, relations: { alumno: { usuario: true } },
      select: expect.objectContaining({ alumno: { idAlumno: true, usuario: { idUsuario: true, nombres: true, apellidos: true } } }),
    }));
  });
  it('impide que un alumno consulte el listado de nombres', async () => {
    await expect(service.list(80, { ...teacher, rol: 'ALUMNO' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(accessible).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
  it('comprueba el curso del docente antes de consultar los alumnos', async () => {
    accessible.mockRejectedValue(new NotFoundException('Tarea no disponible'));
    await expect(service.list(80, teacher)).rejects.toBeInstanceOf(NotFoundException);
    expect(find).not.toHaveBeenCalled();
  });
});
