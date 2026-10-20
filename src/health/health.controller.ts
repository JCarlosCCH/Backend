import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Comprueba que la API atiende solicitudes' })
  @ApiOkResponse({
    schema: { example: { status: 'ok', service: 'gestor-tareas-backend' } },
  })
  check(): { status: string; service: string } {
    return { status: 'ok', service: 'gestor-tareas-backend' };
  }

  @Get('database')
  @ApiOperation({ summary: 'Comprueba la disponibilidad de la base de datos' })
  @ApiOkResponse({ schema: { example: { status: 'available' } } })
  @ApiServiceUnavailableResponse({ description: 'Base de datos no disponible' })
  async checkDatabase(): Promise<{ status: 'available' }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Database query timeout')), 5500);
      });
      const rows: Array<{ ok: number }> = await Promise.race([
        this.dataSource.query('SELECT 1 AS ok'),
        timeout,
      ]);
      if (rows.length !== 1 || rows[0].ok !== 1) throw new Error('Unexpected database result');
      return { status: 'available' };
    } catch {
      throw new ServiceUnavailableException('Base de datos no disponible');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
