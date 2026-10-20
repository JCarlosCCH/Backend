import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envConfig } from './config/env.config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { CursosModule } from './modules/cursos/cursos.module';
import { TareasModule } from './modules/tareas/tareas.module';
import { EntregasModule } from './modules/entregas/entregas.module';

@Module({
  imports: [ConfigModule.forRoot(envConfig), DatabaseModule, HealthModule, AuthModule, CursosModule, TareasModule, EntregasModule],
})
export class AppModule {}
