import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service';

const location = process.env.LOCALAPPDATA;
if (!location) throw new Error('Se requiere LOCALAPPDATA para guardar las credenciales privadas');
const directory = join(location, 'GestorTareas', 'A1');
const file = join(directory, 'auth-dev-credentials.json');

const definitions = [
  { correo: 'docente.a1@example.test', nombres: 'Docente', apellidos: 'Ejemplo', rol: 'DOCENTE', estado: true },
  { correo: 'alumno.a1@example.test', nombres: 'Alumno', apellidos: 'Ejemplo', rol: 'ALUMNO', estado: true },
  { correo: 'alumno.inactivo.a1@example.test', nombres: 'Alumno', apellidos: 'Inactivo', rol: 'ALUMNO', estado: false },
] as const;

async function prepare(): Promise<void> {
  if (existsSync(file)) {
    const existing: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const accounts = existing && typeof existing === 'object' && 'accounts' in existing
      ? existing.accounts
      : undefined;
    if (
      !Array.isArray(accounts) || accounts.length !== definitions.length ||
      !definitions.every((expected, index) => {
        const account: unknown = accounts[index];
        return !!account && typeof account === 'object' &&
          'correo' in account && account.correo === expected.correo &&
          'rol' in account && account.rol === expected.rol &&
          'estado' in account && account.estado === expected.estado &&
          'password' in account && typeof account.password === 'string' && account.password.length >= 10 &&
          'hash' in account && typeof account.hash === 'string' && account.hash.startsWith('$argon2id$');
      })
    ) {
      throw new Error('El archivo privado existente no coincide con las cuentas de A1');
    }
    process.stdout.write(`Archivo privado reutilizado: ${file}\n`);
    return;
  }

  const hasher = new PasswordHasherService();
  const accounts = [];
  for (const account of definitions) {
    const password = randomBytes(36).toString('base64url');
    accounts.push({ ...account, password, hash: await hasher.hash(password) });
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, JSON.stringify({ accounts }, null, 2), { flag: 'wx', mode: 0o600 });
  process.stdout.write(`Archivo privado creado: ${file}\n`);
}

void prepare().catch(() => {
  process.stderr.write('No se pudo preparar el archivo privado de A1.\n');
  process.exitCode = 1;
});
