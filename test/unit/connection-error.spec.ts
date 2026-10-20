import { classifyDatabaseError } from '../../src/database/connection-error';

describe('Clasificación sanitizada de errores de SQL Server', () => {
  it('distingue la fase de configuración', () => {
    expect(classifyDatabaseError(new Error('faltan credenciales'), 'configuration')).toBe(
      'configuración',
    );
  });

  it('distingue certificados y conectividad', () => {
    expect(
      classifyDatabaseError({ code: 'ESOCKET', cause: new Error('certificate verify failed') }, 'connection'),
    ).toBe('certificado');
    expect(classifyDatabaseError(new Error('La cadena de certificación no es de confianza'), 'connection')).toBe(
      'certificado',
    );
    expect(classifyDatabaseError({ code: 'ETIMEOUT' }, 'connection')).toBe('conectividad');
  });

  it('distingue autenticación de acceso a la base', () => {
    expect(classifyDatabaseError({ code: 'ELOGIN', number: 18456 }, 'connection')).toBe(
      'autenticación',
    );
    expect(classifyDatabaseError({ code: 'ELOGIN', originalError: { number: 4060 } }, 'connection')).toBe(
      'acceso a la base',
    );
  });

  it('clasifica errores de consulta sin publicar su mensaje', () => {
    expect(classifyDatabaseError(new Error('consulta interna'), 'query')).toBe('consulta');
  });
});
