import { Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Usuario } from './usuario.entity';

@Entity({ name: 'Alumno', schema: 'dbo' })
export class Alumno {
  @PrimaryColumn({ name: 'IdAlumno', type: 'int' })
  idAlumno!: number;

  @OneToOne(() => Usuario, { nullable: false })
  @JoinColumn({
    name: 'IdAlumno',
    referencedColumnName: 'idUsuario',
    foreignKeyConstraintName: 'FK_Alumno_Usuario',
  })
  usuario!: Usuario;
}
