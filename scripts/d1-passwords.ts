// IPC privado por stdin/stdout. El llamador captura la respuesta: nunca imprimirla en logs.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import { PasswordHasherService } from '../src/modules/auth/password-hasher.service';

interface PrivateRequest {
  mode: 'create' | 'verify';
  accounts: Array<{ correo: string; password?: string; hash?: string }>;
}

async function main(): Promise<void> {
  const envFile = resolve(__dirname, '../.env');
  const local = existsSync(envFile) ? parse(readFileSync(envFile)) : {};
  const mode = process.env.NODE_ENV ?? local.NODE_ENV ?? 'development';
  if (mode !== 'development') throw new Error('Solo desarrollo');
  if (process.argv[2] === 'guard') { process.stdout.write('DEVELOPMENT_OK'); return; }
  const request = JSON.parse(readFileSync(0, 'utf8')) as PrivateRequest;
  const hasher = new PasswordHasherService();
  const results = [];
  for (const account of request.accounts) {
    if (request.mode === 'create') {
      const password = account.password ?? randomBytes(18).toString('base64url');
      results.push({ correo: account.correo, password, hash: await hasher.hash(password) });
    } else if (request.mode === 'verify') {
      if (!account.hash || !account.password) throw new Error('Credencial incompleta');
      results.push({ correo: account.correo, valid: await hasher.verify(account.hash, account.password) });
    } else throw new Error('Modo inválido');
  }
  process.stdout.write(JSON.stringify({ accounts: results }));
}
main().catch(() => { process.stderr.write('No se pudo completar la operación privada de D1.\n'); process.exitCode = 1; });
