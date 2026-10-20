import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createDatabaseOptions } from '../config/database.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const names = [
          'NODE_ENV',
          'PORT',
          'DB_TYPE',
          'DATABASE_URL',
          'DB_SSL',
          'DB_HOST',
          'DB_PORT',
          'DB_INSTANCE',
          'DB_NAME',
          'DB_USER',
          'DB_PASSWORD',
          'DB_ENCRYPT',
          'DB_TRUST_SERVER_CERTIFICATE',
        ] as const;
        const config: Record<string, unknown> = {};
        for (const name of names) config[name] = configService.get(name);

        return {
          ...createDatabaseOptions(config),
          retryAttempts: 2,
          retryDelay: 1000,
          verboseRetryLog: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
