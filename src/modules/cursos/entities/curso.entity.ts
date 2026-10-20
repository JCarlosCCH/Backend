import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Docente } from '../../usuarios/entities/docente.entity';

@Entity({ name: 'Curso', schema: 'dbo' })
@Unique('UQ_Curso_Codigo', ['codigo'])
export class Curso {
  @PrimaryGeneratedColumn({ name: 'IdCurso', type: 'int' })
  idCurso!: number;

  @Column({ name: 'Nombre', type: 'nvarchar', length: 150 })
  nombre!: string;

  @Column({ name: 'Codigo', type: 'nvarchar', length: 30 })
  codigo!: string;

  @Column({ name: 'IdDocente', type: 'int' })
  idDocente!: number;

  @ManyToOne(() => Docente, { nullable: false })
  @JoinColumn({ name: 'IdDocente', referencedColumnName: 'idDocente', foreignKeyConstraintName: 'FK_Curso_Docente' })
  docente!: Docente;

  @Column({ name: 'Estado', type: 'bit', default: true })
  estado!: boolean;
}
