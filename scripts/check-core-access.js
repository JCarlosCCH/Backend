// Comprobaciones negativas de solo lectura o escrituras rechazadas, por HTTP real.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const base = 'http://127.0.0.1:5173/api';

async function main() {
  const idTarea = Number(process.argv[2]);
  const idEntrega = Number(process.argv[3]);
  if (!Number.isSafeInteger(idTarea) || !Number.isSafeInteger(idEntrega)) throw new Error('Indique idTarea e idEntrega');
  const a1 = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, 'GestorTareas', 'A1', 'auth-dev-credentials.json'), 'utf8')).accounts;
  const core = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, 'GestorTareas', 'A1', 'core-dev-credentials.json'), 'utf8')).accounts;
  async function token(correo) {
    const account = [...a1, ...core].find((item) => item.correo === correo);
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, contrasena: account.password }) });
    if (response.status !== 200) throw new Error(`Login ${correo}: HTTP ${response.status}`);
    return (await response.json()).accessToken;
  }
  const teacher = await token('docente.a1@example.test');
  const otherTeacher = await token('docente.core@example.test');
  const student = await token('alumno.a1@example.test');
  const outsider = await token('alumno.ajeno.core@example.test');
  async function status(path, bearer, method = 'GET', body) {
    return (await fetch(`${base}${path}`, { method,
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })).status;
  }
  const cases = {
    noSession: await status(`/tareas/${idTarea}`),
    otherTeacherTask: await status(`/tareas/${idTarea}`, otherTeacher),
    outsiderTask: await status(`/tareas/${idTarea}`, outsider),
    outsiderFile: await status(`/entregas/${idEntrega}/archivo`, outsider),
    studentGrade: await status(`/entregas/${idEntrega}/calificacion`, student, 'PATCH', { nota: 0 }),
    otherTeacherGrade: await status(`/entregas/${idEntrega}/calificacion`, otherTeacher, 'PATCH', { nota: 0 }),
    aboveRange: await status(`/entregas/${idEntrega}/calificacion`, teacher, 'PATCH', { nota: 21 }),
    excessDecimals: await status(`/entregas/${idEntrega}/calificacion`, teacher, 'PATCH', { nota: 0.001 }),
  };
  const expected = { noSession: 401, otherTeacherTask: 404, outsiderTask: 404, outsiderFile: 404,
    studentGrade: 403, otherTeacherGrade: 404, aboveRange: 400, excessDecimals: 400 };
  if (Object.entries(expected).some(([key, value]) => cases[key] !== value)) throw new Error(`Accesos: ${JSON.stringify(cases)}`);
  console.log(`ACCESOS_NEGATIVOS_OK=true ${JSON.stringify(cases)}`);
}

main().catch((error) => { console.error(`ACCESOS_NEGATIVOS_FALLIDOS=${error.message}`); process.exitCode = 1; });
