// Consulta de solo lectura en una instancia nueva para comprobar persistencia.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const base = `http://127.0.0.1:${process.env.CORE_VERIFY_PORT || 5001}/api`;
  const idTarea = Number(process.argv[2]);
  const idEntrega = Number(process.argv[3]);
  if (!Number.isSafeInteger(idTarea) || !Number.isSafeInteger(idEntrega)) {
    throw new Error('Indique idTarea e idEntrega numéricos');
  }
  const credentials = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, 'GestorTareas', 'A1', 'auth-dev-credentials.json'), 'utf8'));
  const student = credentials.accounts.find((item) => item.correo === 'alumno.a1@example.test');
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo: student.correo, contrasena: student.password }) });
  if (login.status !== 200) throw new Error(`Login HTTP ${login.status}`);
  const token = (await login.json()).accessToken;
  const headers = { Authorization: `Bearer ${token}` };
  const taskResponse = await fetch(`${base}/tareas/${idTarea}`, { headers });
  const deliveryResponse = await fetch(`${base}/tareas/${idTarea}/mi-entrega`, { headers });
  if (taskResponse.status !== 200 || deliveryResponse.status !== 200) {
    throw new Error(`Consulta HTTP ${taskResponse.status}/${deliveryResponse.status}`);
  }
  const task = await taskResponse.json();
  const { entrega } = await deliveryResponse.json();
  if (task.idTarea !== idTarea || entrega?.idEntrega !== idEntrega || entrega.nota !== 0 || entrega.estado !== 'REVISADA') {
    throw new Error('Los datos persistidos no coinciden');
  }
  console.log(`PERSISTENCIA_OK=true TAREA=${task.idTarea} ENTREGA=${entrega.idEntrega} NOTA=${entrega.nota} ESTADO=${entrega.estado}`);
}

main().catch((error) => { console.error(`PERSISTENCIA_FALLIDA=${error.message}`); process.exitCode = 1; });
