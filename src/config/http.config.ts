import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NodeEnvironment } from './env.config';

export function configureHttp(app: INestApplication, environment?: NodeEnvironment): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const nodeEnv = environment ?? app.get(ConfigService).getOrThrow<NodeEnvironment>('NODE_ENV');
  if (nodeEnv === 'development') {
    const config = new DocumentBuilder()
      .setTitle('Gestor de Tareas - API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }
}
