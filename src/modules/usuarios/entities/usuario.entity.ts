import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'Usuario', schema: 'dbo' })
@Unique('UQ_Usuario_Correo', ['correo'])
export class Usuario {
  @PrimaryGeneratedColumn({ name: 'IdUsuario', type: 'int' })
  idUsuario!: number;

  @Column({ name: 'Nombres', type: 'nvarchar', length: 80 })
  nombres!: string;

  @Column({ name: 'Apellidos', type: 'nvarchar', length: 80 })
  apellidos!: string;

  @Column({ name: 'Correo', type: 'nvarchar', length: 150 })
  correo!: string;

  @Column({ name: 'ContrasenaHash', type: 'nvarchar', length: 255, select: false })
  contrasenaHash!: string;

  @Column({ name: 'Estado', type: 'bit', default: true })
  estado!: boolean;

  @Column({ name: 'FechaRegistro', type: 'datetime2', default: () => 'SYSDATETIME()' })
  fechaRegistro!: Date;
}
