// Solo lecturas SQL/HTTP e inicio de sesión. No crea tareas, entregas ni notas.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'dotenv';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../src/config/database.config';
import { LoginResponse } from '../src/modules/auth/auth.types';
import { CursoPublico } from '../src/modules/cursos/cursos.service';
import { EntregaListado } from '../src/modules/entregas/entregas.service';
import scenario from './primaria-4a.json';

interface Credential { correo: string; password: string }
interface Credentials { scenario: string; accounts: Credential[] }
interface Manifest {
  scenario: string;
  accounts: Array<{ correo: string; idUsuario: number }>;
  courses: CursoPublico[];
}
const origin = 'http://127.0.0.1:5000/api';
let lastLogin = 0;
let database: DataSource | undefined;

async function call(path: string, token?: string): Promise<Response> {
  return fetch(`${origin}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(10000) });
}
async function login(account: Credential): Promise<LoginResponse> {
  const wait = Math.max(0, 13000 - (Date.now() - lastLogin));
  if (wait) await delay(wait);
  for (let retry = 0; retry < 3; retry += 1) {
    lastLogin = Date.now();
    const response = await fetch(`${origin}/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ correo: account.correo, contrasena: account.password }) });
    if (response.status === 429) {
      const seconds = Math.max(61, Number(response.headers.get('retry-after')) || 0);
      console.log(`LIMITADOR HTTP=429; espera ${seconds}s, sin cambiar la configuración.`);
      for (let left = seconds; left > 0; left -= 15) await delay(Math.min(15, left) * 1000);
      continue;
    }
    if (response.status !== 200) throw new Error(`Login HTTP ${response.status}: ${account.correo}`);
    const body = await response.json() as LoginResponse;
    assert.equal(typeof body.accessToken, 'string');
    return body;
  }
  throw new Error('Limitador aún activo; verificación incompleta.');
}

async function main(): Promise<void> {
  const configuration = { ...parse(readFileSync(resolve(__dirname, '../.env'))), ...process.env };
  if ((configuration.NODE_ENV ?? 'development') !== 'development') throw new Error('Solo desarrollo.');
  database = new DataSource(createDatabaseOptions(configuration));
  await database.initialize();
  const [target]: Array<{ machine: string; instance: string; base_actual: string }> = await database.query("SELECT CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) machine, CONVERT(nvarchar(128),SERVERPROPERTY('InstanceName')) instance, DB_NAME() base_actual");
  assert.equal(target.machine.toLowerCase(), 'lizandrotanta');
  assert.equal(target.instance, 'MSSQLSERVER03');
  assert.equal(target.base_actual, 'GestorTareasDB');
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('Falta LOCALAPPDATA.');
  const directory = join(localAppData, 'GestorTareas', 'D1');
  const credentials = JSON.parse(readFileSync(join(directory, 'PRIMARIA_4A_V1.credentials.json'), 'utf8')) as Credentials;
  const manifest = JSON.parse(readFileSync(join(directory, 'PRIMARIA_4A_V1.manifest.json'), 'utf8')) as Manifest;
  assert.equal(credentials.scenario, scenario.scenario);
  assert.equal(manifest.scenario, scenario.scenario);
  const health = await call('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'gestor-tareas-backend' });
  const dbHealth = await call('/health/database');
  assert.equal(dbHealth.status, 200);
  assert.deepEqual(await dbHealth.json(), { status: 'available' });
  console.log('HEALTH HTTP=200 DATABASE_HEALTH HTTP=200 DESTINO_SQL_CONFIRMADO=true');
  let teacherToken;
  let studentToken;
  for (const expected of scenario.accounts) {
    const account = credentials.accounts.find((item) => item.correo === expected.correo);
    if (!account) throw new Error(`Credencial local ausente: ${expected.correo}; no se restablece.`);
    const session = await login(account);
    const stored = manifest.accounts.find((item) => item.correo === expected.correo);
    assert.ok(stored);
    assert.deepEqual(session.usuario, { idUsuario: stored.idUsuario, nombres: expected.nombres, apellidos: expected.apellidos, correo: expected.correo, rol: expected.rol });
    const response = await call('/cursos', session.accessToken);
    assert.equal(response.status, 200);
    const courses = await response.json() as CursoPublico[];
    assert.deepEqual(courses.map((item) => ({ idCurso: item.idCurso, codigo: item.codigo, nombre: item.nombre })).sort((a, b) => a.codigo.localeCompare(b.codigo)),
      manifest.courses.map((item) => ({ idCurso: item.idCurso, codigo: item.codigo, nombre: item.nombre })).sort((a, b) => a.codigo.localeCompare(b.codigo)));
    assert.equal(courses.length, 5);
    console.log(`${expected.reference} ${expected.correo} LOGIN=200 CURSOS=200 cantidad=5 ajenos=0 identidad_unicode=OK`);
    if (expected.rol === 'DOCENTE') {
      teacherToken = session.accessToken;
      for (const course of courses) {
        const tasks = await call(`/cursos/${course.idCurso}/tareas`, teacherToken);
        assert.equal(tasks.status, 200);
        const count = (await tasks.json() as unknown[]).length;
        console.log(`CURSO ${course.codigo} LISTADO_TAREAS=200 cantidad=${count}`);
      }
    } else studentToken ??= session.accessToken;
  }

  // Se reutiliza una entrega anterior solo para leer el contrato ampliado, sin crear datos D1.
  const [existing]: Array<{ idTarea: number; correo: string }> = await database.query(`SELECT TOP (1) t.IdTarea idTarea,u.Correo correo
    FROM dbo.Entrega e JOIN dbo.Tarea t ON t.IdTarea=e.IdTarea JOIN dbo.Curso c ON c.IdCurso=t.IdCurso
    JOIN dbo.Docente d ON d.IdDocente=c.IdDocente JOIN dbo.Usuario u ON u.IdUsuario=d.IdDocente
    WHERE c.Codigo NOT LIKE @0 ORDER BY e.IdEntrega`, ['PRU4A-%']);
  if (existing) {
    let previousAccount: Credential | undefined;
    for (const filename of ['auth-dev-credentials.json', 'core-dev-credentials.json']) {
      const file = join(localAppData, 'GestorTareas', 'A1', filename);
      if (existsSync(file)) previousAccount ??= (JSON.parse(readFileSync(file, 'utf8')) as Credentials).accounts.find((item) => item.correo === existing.correo);
    }
    if (previousAccount) {
      const previousSession = await login(previousAccount);
      const path = `/tareas/${existing.idTarea}/entregas`;
      const response = await call(path, previousSession.accessToken);
      assert.equal(response.status, 200);
      const rows = await response.json() as EntregaListado[];
      const expected = await database.query(`SELECT e.IdEntrega idEntrega,e.IdAlumno idAlumno,u.Nombres nombresAlumno,u.Apellidos apellidosAlumno
        FROM dbo.Entrega e JOIN dbo.Alumno a ON a.IdAlumno=e.IdAlumno JOIN dbo.Usuario u ON u.IdUsuario=a.IdAlumno
        WHERE e.IdTarea=@0 ORDER BY e.IdEntrega`, [existing.idTarea]);
      assert.deepEqual(rows.map(({ idEntrega, idAlumno, nombresAlumno, apellidosAlumno }) => ({ idEntrega, idAlumno, nombresAlumno, apellidosAlumno }))
        .sort((a, b) => a.idEntrega - b.idEntrega), expected);
      const fields = ['idEntrega', 'idTarea', 'idAlumno', 'comentario', 'fechaEntrega', 'estado', 'nota', 'observacionDocente', 'tieneArchivo', 'nombresAlumno', 'apellidosAlumno'].sort();
      rows.forEach((row) => assert.deepEqual(Object.keys(row).sort(), fields));
      assert.equal((await call(path, teacherToken)).status, 404);
      assert.equal((await call(path, studentToken)).status, 403);
      assert.equal((await call(path)).status, 401);
      console.log(`NOMBRES_REALES listado=200 coincidencia_SQL=true filas=${rows.length} docente_ajeno=404 alumno=403 anonimo=401`);
    } else console.log('NOMBRES_HTTP=PENDIENTE: falta credencial del docente de la entrega anterior; no se crean entregas.');
  } else console.log('NOMBRES_HTTP=PENDIENTE: no hay entregas anteriores para consultar; no se crean entregas.');
  console.log('D1_HTTP_OK cuentas=11 cursos_por_identidad=5 ESCRITURAS_ACADEMICAS=0');
}
main().catch((error: unknown) => {
  // No imprimir objetos de respuesta, aserciones, tokens, credenciales ni errores del driver.
  const message = error instanceof Error ? error.message : '';
  const allowed = /^(Login HTTP|Credencial local ausente|Limitador aún activo|Solo desarrollo)/.test(message);
  console.error(allowed ? message : 'D1_HTTP_FALLO: la comprobación no coincide o el servicio no está disponible.');
  process.exitCode = 1;
}).finally(async () => { if (database?.isInitialized) await database.destroy(); });
