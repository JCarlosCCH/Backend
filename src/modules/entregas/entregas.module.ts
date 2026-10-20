import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { TareasModule } from '../tareas/tareas.module';
import { EntregasController } from './entregas.controller';
import { EntregasService } from './entregas.service';
import { Entrega } from './entities/entrega.entity';

@Module({
  imports: [AuthModule, TareasModule, FilesModule, TypeOrmModule.forFeature([Entrega])],
  controllers: [EntregasController],
  providers: [EntregasService],
})
export class EntregasModule {}
