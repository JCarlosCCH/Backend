import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Curso } from '../../cursos/entities/curso.entity';

@Entity({ name: 'Tarea', schema: 'dbo' })
export class Tarea {
  @PrimaryGeneratedColumn({ name: 'IdTarea', type: 'int' })
  idTarea!: number;

  @Column({ name: 'IdCurso', type: 'int' })
  idCurso!: number;

  @ManyToOne(() => Curso, { nullable: false })
  @JoinColumn({ name: 'IdCurso', referencedColumnName: 'idCurso', foreignKeyConstraintName: 'FK_Tarea_Curso' })
  curso!: Curso;

  @Column({ name: 'Titulo', type: 'nvarchar', length: 200 })
  titulo!: string;

  @Column({ name: 'Descripcion', type: 'nvarchar', length: 'MAX' })
  descripcion!: string;

  @Column({ name: 'ArchivoReferencia', type: 'nvarchar', length: 500, nullable: true })
  archivoReferencia!: string | null;

  @Column({ name: 'FechaPublicacion', type: 'datetime2', default: () => 'SYSDATETIME()' })
  fechaPublicacion!: Date;

  @Column({ name: 'FechaLimite', type: 'datetime2' })
  fechaLimite!: Date;

  @Column({ name: 'Estado', type: 'varchar', length: 12, default: 'PUBLICADA' })
  estado!: 'BORRADOR' | 'PUBLICADA' | 'CERRADA';
}
