// Recorrido manual: crea una tarea y entrega nuevas en la base de desarrollo.
// Requiere API :5000, proxy :5173 y credenciales locales privadas de A1.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

const origin = 'http://127.0.0.1:5173';
const credentials = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, 'GestorTareas', 'A1', 'auth-dev-credentials.json'), 'utf8'));
const pdf = readFileSync(process.argv[2] || join(process.env.TEMP, 'gestor-tareas-core-piloto.pdf'));
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function call(path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method, headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body,
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, data, headers: response.headers };
}

async function login(correo) {
  const account = credentials.accounts.find((item) => item.correo === correo);
  if (!account) throw new Error(`Falta cuenta de desarrollo: ${correo}`);
  const result = await call('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo: account.correo, contrasena: account.password }) });
  if (result.status !== 200) throw new Error(`Login ${correo}: HTTP ${result.status}`);
  return result.data.accessToken;
}

function multipart(fields, includePdf) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (includePdf) form.append('archivo', new Blob([pdf], { type: 'application/pdf' }), 'piloto.pdf');
  return form;
}

async function main() {
  const docente = await login('docente.a1@example.test');
  const alumno = await login('alumno.a1@example.test');
  const courses = await call('/cursos', { token: docente });
  const course = courses.data.find((item) => item.codigo === 'CORE-MAT-3A');
  if (courses.status !== 200 || !course) throw new Error('No se encontró el curso de desarrollo');
  const title = `Recorrido completo ${new Date().toISOString()}`;
  const created = await call(`/cursos/${course.idCurso}/tareas`, { method: 'POST', token: docente,
    body: multipart({ titulo: title, descripcion: 'PDF, entrega y calificación del piloto',
      fechaLimite: new Date(Date.now() + 2 * 86400000).toISOString() }, true) });
  if (created.status !== 201 || !created.data.tieneArchivoReferencia) throw new Error(`Crear tarea: HTTP ${created.status}`);
  const idTarea = created.data.idTarea;
  const seen = await call(`/tareas/${idTarea}`, { token: alumno });
  const reference = await call(`/tareas/${idTarea}/archivo`, { token: alumno });
  if (seen.status !== 200 || reference.status !== 200 || sha(reference.data) !== sha(pdf)) {
    throw new Error('La tarea o su PDF no está disponible para el alumno');
  }
  const send = () => call(`/tareas/${idTarea}/entregas`, { method: 'POST', token: alumno,
    body: multipart({ comentario: 'Trabajo del recorrido' }, true) });
  const submissions = await Promise.all([send(), send()]);
  if (submissions.map((item) => item.status).sort().join(',') !== '201,409') {
    throw new Error(`Concurrencia: HTTP ${submissions.map((item) => item.status).join(',')}`);
  }
  const delivery = submissions.find((item) => item.status === 201).data;
  const listed = await call(`/tareas/${idTarea}/entregas`, { token: docente });
  const download = await call(`/entregas/${delivery.idEntrega}/archivo`, { token: docente });
  if (listed.status !== 200 || listed.data.length !== 1 || download.status !== 200 || sha(download.data) !== sha(pdf)) {
    throw new Error('La entrega no se listó o descargó correctamente');
  }
  const graded = await call(`/entregas/${delivery.idEntrega}/calificacion`, { method: 'PATCH', token: docente,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nota: 0, observacionDocente: 'Revisado en piloto' }) });
  const own = await call(`/tareas/${idTarea}/mi-entrega`, { token: alumno });
  if (graded.status !== 200 || graded.data.nota !== 0 || graded.data.estado !== 'REVISADA' ||
    own.status !== 200 || own.data.entrega.nota !== 0 || own.data.entrega.estado !== 'REVISADA') {
    throw new Error(`Calificación o consulta: HTTP ${graded.status}/${own.status}`);
  }
  console.log(`PROXY_RECORRIDO_OK=true CURSO=${course.idCurso} TAREA=${idTarea} ENTREGA=${delivery.idEntrega}`);
  console.log(`TAREA_HTTP=${created.status} ALUMNO_CONSULTA=${seen.status} REFERENCIA_HTTP=${reference.status} REFERENCIA_SHA256_IGUAL=true`);
  console.log(`ENTREGAS_CONCURRENTES_HTTP=${submissions.map((item) => item.status).join(',')} LISTA_DOCENTE=${listed.status} DESCARGA_HTTP=${download.status} DESCARGA_SHA256_IGUAL=true`);
  console.log(`CALIFICACION_HTTP=${graded.status} NOTA=${graded.data.nota} ESTADO=${graded.data.estado} CONSULTA_ALUMNO_HTTP=${own.status}`);
}

main().catch((error) => { console.error(`VERIFICACION_FALLIDA=${error.message}`); process.exitCode = 1; });
