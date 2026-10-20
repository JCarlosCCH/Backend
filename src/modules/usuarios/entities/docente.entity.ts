import { Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Usuario } from './usuario.entity';

@Entity({ name: 'Docente', schema: 'dbo' })
export class Docente {
  @PrimaryColumn({ name: 'IdDocente', type: 'int' })
  idDocente!: number;

  @OneToOne(() => Usuario, { nullable: false })
  @JoinColumn({
    name: 'IdDocente',
    referencedColumnName: 'idUsuario',
    foreignKeyConstraintName: 'FK_Docente_Usuario',
  })
  usuario!: Usuario;
}
