export type DatabaseErrorCategory =
  | 'configuración'
  | 'conectividad'
  | 'certificado'
  | 'autenticación'
  | 'acceso a la base'
  | 'consulta'
  | 'desconocido';

type FailurePhase = 'configuration' | 'connection' | 'query';

export function classifyDatabaseError(error: unknown, phase: FailurePhase): DatabaseErrorCategory {
  if (phase === 'configuration') return 'configuración';

  const values: Array<{ code?: unknown; number?: unknown; message?: unknown }> = [];
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const item = current as Record<string, unknown>;
    values.push(item);
    current = item.originalError ?? item.driverError ?? item.cause ?? item.parent;
  }

  const numbers = values.map((value) => value.number);
  const codes = values.map((value) => value.code);
  if (codes.some((code) => ['3D000', '42501'].includes(String(code)))) return 'acceso a la base';
  if (codes.some((code) => ['28P01', '28000'].includes(String(code)))) return 'autenticación';
  const messages = values
    .map((value) => value.message)
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  if (numbers.some((number) => number === 4060 || number === 916 || number === 229 || number === 911)) {
    return 'acceso a la base';
  }
  if (/certific|trust chain|unable to verify|self.signed/i.test(messages)) {
    return 'certificado';
  }
  if (numbers.includes(18456) || codes.includes('ELOGIN')) return 'autenticación';
  if (
    codes.some((code) =>
      ['ESOCKET', 'ETIMEOUT', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', 'EINSTLOOKUP', 'ECONNCLOSED', 'ECONNREFUSED', 'ENOTFOUND'].includes(
        String(code),
      ),
    )
  ) {
    return 'conectividad';
  }
  return phase === 'query' ? 'consulta' : 'desconocido';
}
