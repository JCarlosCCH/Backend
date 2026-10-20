import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CursosModule } from '../cursos/cursos.module';
import { FilesModule } from '../files/files.module';
import { Tarea } from './entities/tarea.entity';
import { TareasController } from './tareas.controller';
import { TareasService } from './tareas.service';

@Module({
  imports: [AuthModule, CursosModule, FilesModule, TypeOrmModule.forFeature([Tarea])],
  controllers: [TareasController],
  providers: [TareasService],
  exports: [TareasService],
})
export class TareasModule {}
