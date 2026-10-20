import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthController } from '../../src/health/health.controller';

describe('HealthController', () => {
  const query = jest.fn();
  const controller = new HealthController({ query } as unknown as DataSource);

  beforeEach(() => query.mockReset());

  it('indica que la API responde sin afirmar conexión a la base', () => {
    expect(controller.check()).toEqual({
      status: 'ok',
      service: 'gestor-tareas-backend',
    });
  });

  it('indica disponibilidad tras ejecutar SELECT 1', async () => {
    query.mockResolvedValue([{ ok: 1 }]);
    await expect(controller.checkDatabase()).resolves.toEqual({ status: 'available' });
    expect(query).toHaveBeenCalledWith('SELECT 1 AS ok');
  });

  it('responde 503 genérico ante un error de consulta', async () => {
    query.mockRejectedValue(new Error('detalle privado del servidor'));
    await expect(controller.checkDatabase()).rejects.toThrow(
      new ServiceUnavailableException('Base de datos no disponible'),
    );
  });

  it('responde 503 si la consulta excede el tiempo límite', async () => {
    jest.useFakeTimers();
    try {
      query.mockImplementation(() => new Promise(() => undefined));
      const response = controller.checkDatabase();
      const expectation = expect(response).rejects.toThrow(ServiceUnavailableException);
      await jest.advanceTimersByTimeAsync(5500);
      await expectation;
    } finally {
      jest.useRealTimers();
    }
  });
});
