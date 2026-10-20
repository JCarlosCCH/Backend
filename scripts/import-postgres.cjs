const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const columns = {
  Usuario: ['IdUsuario','Nombres','Apellidos','Correo','ContrasenaHash','Estado','FechaRegistro'],
  Docente: ['IdDocente'],
  Alumno: ['IdAlumno'],
  Curso: ['IdCurso','Nombre','Codigo','IdDocente','Estado'],
  Matricula: ['IdMatricula','IdCurso','IdAlumno','FechaMatricula','Estado'],
  Tarea: ['IdTarea','IdCurso','Titulo','Descripcion','ArchivoReferencia','FechaPublicacion','FechaLimite','Estado'],
  Entrega: ['IdEntrega','IdTarea','IdAlumno','ArchivoUrl','Comentario','FechaEntrega','Estado','Nota','ObservacionDocente'],
};
const identities = { Usuario:'IdUsuario', Curso:'IdCurso', Matricula:'IdMatricula', Tarea:'IdTarea', Entrega:'IdEntrega' };
const quote = (value) => '"' + value.replaceAll('"','""') + '"';

function targetConfig() {
  const file = path.resolve(__dirname, '../.env.render.local');
  const privateConfig = fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
  const value = process.env.DATABASE_URL || privateConfig.DATABASE_URL;
  if (!value) throw new Error('Guarda External Database URL como DATABASE_URL en Backend/.env.render.local');
  let url;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL inválida'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error('DATABASE_URL inválida');
  const ssl = process.env.DB_SSL || privateConfig.DB_SSL || 'verify-full';
  if (!['disable','require','verify-full'].includes(ssl)) throw new Error('DB_SSL inválido');
  return {
    host:url.hostname, port:Number(url.port || 5432), user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password), database:decodeURIComponent(url.pathname.slice(1)),
    ssl:ssl === 'disable' ? false : { rejectUnauthorized: ssl === 'verify-full' },
    connectionTimeoutMillis:15000, statement_timeout:30000,
  };
}

function readExport(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/,''));
  return validateExport(data);
}

function validateExport(data) {
  if (data.version !== 1 || data.database !== 'GestorTareasDB' || !data.tables) throw new Error('Exportación de origen inválida');
  for (const [table, fields] of Object.entries(columns)) {
    if (!Array.isArray(data.tables[table])) throw new Error('Falta la tabla ' + table);
    for (const row of data.tables[table]) {
      if (fields.some((field) => !Object.hasOwn(row, field))) throw new Error('Faltan columnas en ' + table);
      if (!Number.isSafeInteger(row[fields[0]]) || row[fields[0]] < 1) throw new Error('ID inválido en ' + table);
    }
  }
  return data;
}

function readFiles(data, storageDirectory) {
  const names = new Set([
    ...data.tables.Tarea.map((row) => row.ArchivoReferencia).filter(Boolean),
    ...data.tables.Entrega.map((row) => row.ArchivoUrl),
  ]);
  return [...names].map((name) => {
    if (!/^(task|submission)-[0-9a-f-]{36}\.pdf$/.test(name)) throw new Error('Referencia de archivo inválida');
    const content = fs.readFileSync(path.join(storageDirectory,name));
    if (!content.length || content.length > 10485760 || content.subarray(0,5).toString('ascii') !== '%PDF-' || !content.subarray(-1024).includes(Buffer.from('%%EOF'))) {
      throw new Error('Un PDF de origen no es válido');
    }
    return { name, content };
  });
}

function canonical(rows, fields) {
  return rows.slice().sort((a,b) => a[fields[0]] - b[fields[0]]).map((row) => fields.map((field) => {
    const value = row[field];
    if (value === null) return null;
    if (field.startsWith('Fecha')) return new Date(value).toISOString();
    if (field === 'Nota') return Number(value);
    return value;
  }));
}

async function verify(client, data, files) {
  const result = {};
  for (const [table, fields] of Object.entries(columns)) {
    const rows = (await client.query(`SELECT ${fields.map(quote).join(',')} FROM dbo.${quote(table)} ORDER BY ${quote(fields[0])}`)).rows;
    if (JSON.stringify(canonical(rows,fields)) !== JSON.stringify(canonical(data.tables[table],fields))) throw new Error('Verificación de datos fallida en ' + table);
    result[table] = rows.length;
  }
  const savedFiles = (await client.query('SELECT "Nombre", "Contenido" FROM dbo."Archivo"')).rows;
  if (savedFiles.length !== files.length || files.some((file) => !savedFiles.some((row) => row.Nombre === file.name && file.content.equals(row.Contenido)))) {
    throw new Error('Verificación de PDF fallida');
  }
  result.PDF = files.length;
  return result;
}

async function importDatabase(client, data, files, schema, verifyOnly = false, hooks = {}) {
  await client.query('BEGIN');
  try {
    if (!verifyOnly) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gestor-tareas-import'))");
      if (hooks.alreadyImported && await hooks.alreadyImported(client)) {
        await client.query('COMMIT');
        return { alreadyImported: true };
      }
      await client.query(schema);
      const tables = [...Object.keys(columns),'Archivo'];
      await client.query(`LOCK TABLE ${tables.map((table) => 'dbo.' + quote(table)).join(',')} IN ACCESS EXCLUSIVE MODE`);
      for (const table of tables) {
        if (Number((await client.query(`SELECT count(*) AS total FROM dbo.${quote(table)}`)).rows[0].total) !== 0) {
          throw new Error('La base destino contiene datos; se canceló la importación sin reemplazarlos');
        }
      }
      for (const [table, fields] of Object.entries(columns)) {
        for (const row of data.tables[table]) {
          await client.query(`INSERT INTO dbo.${quote(table)} (${fields.map(quote).join(',')}) VALUES (${fields.map((_,i) => '$' + (i+1)).join(',')})`, fields.map((field) => row[field]));
        }
      }
      for (const file of files) await client.query('INSERT INTO dbo."Archivo" ("Nombre","Contenido") VALUES ($1,$2)',[file.name,file.content]);
      for (const [table,id] of Object.entries(identities)) {
        await client.query(`SELECT setval(pg_get_serial_sequence($1,$2), COALESCE(MAX(${quote(id)}),1), MAX(${quote(id)}) IS NOT NULL) FROM dbo.${quote(table)}`, ['dbo.' + quote(table),id]);
      }
    }
    const result = await verify(client,data,files);
    if (!verifyOnly && hooks.afterVerify) await hooks.afterVerify(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function main() {
  const privateDirectory = path.join(process.env.LOCALAPPDATA || '', 'GestorTareas','Render');
  const data = readExport(path.join(privateDirectory,'sqlserver-export.json'));
  const files = readFiles(data,path.resolve(__dirname,'../storage'));
  const schema = fs.readFileSync(path.resolve(__dirname,'schema.postgres.sql'),'utf8');
  const client = new Client(targetConfig());
  try {
    await client.connect();
    console.log(JSON.stringify(await importDatabase(client,data,files,schema,process.argv.includes('--verify-only'))));
  } finally { await client.end(); }
}

module.exports = { columns, readExport, validateExport, readFiles, importDatabase, targetConfig };
if (require.main === module) main().catch((error) => {
  // Nunca imprimir errores del driver que puedan contener filas, hashes o la URL.
  const safe = /^(Guarda |DATABASE_URL |DB_SSL |Exportación |Falta |Faltan |ID inválido|Referencia |Un PDF |Verificación |La base destino)/;
  console.error(safe.test(error.message) ? error.message : 'No se pudo completar la importación (' + (error.code || 'error') + ').');
  process.exitCode = 1;
});
