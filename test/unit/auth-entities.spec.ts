import { getMetadataArgsStorage } from 'typeorm';
import { AUTH_ENTITIES } from '../../src/config/database.config';
import { Alumno } from '../../src/modules/usuarios/entities/alumno.entity';
import { Docente } from '../../src/modules/usuarios/entities/docente.entity';
import { Usuario } from '../../src/modules/usuarios/entities/usuario.entity';

describe('Mapeo de identidad y perfiles', () => {
  const metadata = getMetadataArgsStorage();

  it('registra solo Usuario, Docente y Alumno en dbo', () => {
    expect(AUTH_ENTITIES).toEqual([Usuario, Docente, Alumno]);
    for (const entity of AUTH_ENTITIES) {
      expect(metadata.tables.find((table) => table.target === entity)).toMatchObject({ schema: 'dbo' });
    }
  });

  it('mantiene IDENTITY solo en Usuario y claves compartidas no generadas', () => {
    expect(metadata.generations.find((value) => value.target === Usuario && value.propertyName === 'idUsuario'))
      .toMatchObject({ strategy: 'increment' });
    for (const [entity, property, column] of [
      [Docente, 'idDocente', 'IdDocente'],
      [Alumno, 'idAlumno', 'IdAlumno'],
    ] as const) {
      expect(metadata.generations.find((value) => value.target === entity)).toBeUndefined();
      expect(metadata.columns.find((value) => value.target === entity && value.propertyName === property)?.options)
        .toMatchObject({ name: column, type: 'int', primary: true });
      expect(metadata.joinColumns.find((value) => value.target === entity && value.propertyName === 'usuario'))
        .toMatchObject({ name: column, referencedColumnName: 'idUsuario' });
      expect(metadata.relations.find((value) => value.target === entity && value.propertyName === 'usuario'))
        .toMatchObject({ relationType: 'one-to-one' });
    }
  });

  it('excluye ContrasenaHash de las selecciones predeterminadas', () => {
    expect(metadata.columns.find((value) => value.target === Usuario && value.propertyName === 'contrasenaHash')?.options)
      .toMatchObject({ name: 'ContrasenaHash', type: 'nvarchar', length: 255, select: false });
  });
});
