import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Alumno } from '../../usuarios/entities/alumno.entity';
import { Tarea } from '../../tareas/entities/tarea.entity';

@Entity({ name: 'Entrega', schema: 'dbo' })
@Unique('UQ_Entrega_Tarea_Alumno', ['idTarea', 'idAlumno'])
export class Entrega {
  @PrimaryGeneratedColumn({ name: 'IdEntrega', type: 'int' })
  idEntrega!: number;

  @Column({ name: 'IdTarea', type: 'int' })
  idTarea!: number;

  @ManyToOne(() => Tarea, { nullable: false })
  @JoinColumn({ name: 'IdTarea', referencedColumnName: 'idTarea', foreignKeyConstraintName: 'FK_Entrega_Tarea' })
  tarea!: Tarea;

  @Column({ name: 'IdAlumno', type: 'int' })
  idAlumno!: number;

  @ManyToOne(() => Alumno, { nullable: false })
  @JoinColumn({ name: 'IdAlumno', referencedColumnName: 'idAlumno', foreignKeyConstraintName: 'FK_Entrega_Alumno' })
  alumno!: Alumno;

  @Column({ name: 'ArchivoUrl', type: 'nvarchar', length: 500 })
  archivoUrl!: string;

  @Column({ name: 'Comentario', type: 'nvarchar', length: 500, nullable: true })
  comentario!: string | null;

  @Column({ name: 'FechaEntrega', type: 'datetime2', default: () => 'SYSDATETIME()' })
  fechaEntrega!: Date;

  @Column({ name: 'Estado', type: 'varchar', length: 10, default: 'ENTREGADA' })
  estado!: 'ENTREGADA' | 'REVISADA';

  @Column({ name: 'Nota', type: 'decimal', precision: 4, scale: 2, nullable: true })
  nota!: number | null;

  @Column({ name: 'ObservacionDocente', type: 'nvarchar', length: 500, nullable: true })
  observacionDocente!: string | null;
}
