import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Alumno } from '../../usuarios/entities/alumno.entity';
import { Curso } from '../../cursos/entities/curso.entity';

@Entity({ name: 'Matricula', schema: 'dbo' })
@Unique('UQ_Matricula_Curso_Alumno', ['idCurso', 'idAlumno'])
export class Matricula {
  @PrimaryGeneratedColumn({ name: 'IdMatricula', type: 'int' })
  idMatricula!: number;

  @Column({ name: 'IdCurso', type: 'int' })
  idCurso!: number;

  @ManyToOne(() => Curso, { nullable: false })
  @JoinColumn({ name: 'IdCurso', referencedColumnName: 'idCurso', foreignKeyConstraintName: 'FK_Matricula_Curso' })
  curso!: Curso;

  @Column({ name: 'IdAlumno', type: 'int' })
  idAlumno!: number;

  @ManyToOne(() => Alumno, { nullable: false })
  @JoinColumn({ name: 'IdAlumno', referencedColumnName: 'idAlumno', foreignKeyConstraintName: 'FK_Matricula_Alumno' })
  alumno!: Alumno;

  @Column({ name: 'FechaMatricula', type: 'datetime2', default: () => 'SYSDATETIME()' })
  fechaMatricula!: Date;

  @Column({ name: 'Estado', type: 'varchar', length: 10, default: 'ACTIVA' })
  estado!: 'ACTIVA' | 'RETIRADA';
}
