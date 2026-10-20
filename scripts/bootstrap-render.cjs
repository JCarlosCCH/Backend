const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const { validateExport, importDatabase, targetConfig } = require('./import-postgres.cjs');

function readBundle(file) {
  const encoded = fs.readFileSync(file,'utf8').trim();
  if (!encoded || encoded.length > 1000000 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) throw new Error('Paquete de importación inválido');
  const compressed = Buffer.from(encoded,'base64');
  const bundle = JSON.parse(zlib.gunzipSync(compressed,{maxOutputLength:32*1024*1024}).toString('utf8'));
  if (bundle.version !== 1 || !Array.isArray(bundle.files)) throw new Error('Paquete de importación inválido');
  const data = validateExport(bundle.source);
  const files = bundle.files.map((file) => {
    if (typeof file.name !== 'string' || !/^(task|submission)-[0-9a-f-]{36}\.pdf$/.test(file.name) || typeof file.content !== 'string') throw new Error('Referencia de archivo inválida');
    const content = Buffer.from(file.content,'base64');
    if (!content.length || content.length > 10485760 || content.subarray(0,5).toString('ascii') !== '%PDF-' || !content.subarray(-1024).includes(Buffer.from('%%EOF'))) throw new Error('PDF de importación inválido');
    return {name:file.name,content};
  });
  const references = new Set([...data.tables.Tarea.map((row) => row.ArchivoReferencia).filter(Boolean),...data.tables.Entrega.map((row) => row.ArchivoUrl)]);
  if (files.length !== references.size || new Set(files.map((file) => file.name)).size !== files.length || files.some((file) => !references.has(file.name))) throw new Error('Faltan PDF en el paquete de importación');
  return {data,files,digest:createHash('sha256').update(compressed).digest('hex')};
}

async function bootstrap(client,bundle) {
  const schema = fs.readFileSync(path.resolve(__dirname,'schema.postgres.sql'),'utf8');
  return importDatabase(client,bundle.data,bundle.files,schema,false,{
    async alreadyImported(connection) {
      const exists = (await connection.query("SELECT to_regclass('dbo.\"DemoImport\"') AS tabla")).rows[0].tabla;
      if (!exists) return false;
      const previous = (await connection.query('SELECT "Digest" FROM dbo."DemoImport" WHERE "Nombre" = $1',['sqlserver-demo-v1'])).rows[0];
      if (!previous) return false;
      if (previous.Digest !== bundle.digest) throw new Error('La base tiene otra importación; no se reemplazarán sus datos');
      return true;
    },
    async afterVerify(connection) {
      await connection.query('CREATE TABLE IF NOT EXISTS dbo."DemoImport" ("Nombre" text PRIMARY KEY, "Digest" varchar(64) NOT NULL, "Fecha" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      await connection.query('INSERT INTO dbo."DemoImport" ("Nombre","Digest") VALUES ($1,$2)',['sqlserver-demo-v1',bundle.digest]);
    },
  });
}

async function main() {
  const file = process.env.RENDER_IMPORT_FILE || '/etc/secrets/render-bootstrap.b64';
  if (!fs.existsSync(file)) throw new Error('Falta el Secret File render-bootstrap.b64');
  const bundle = readBundle(file);
  const client = new Client(targetConfig());
  try { await client.connect(); console.log(JSON.stringify(await bootstrap(client,bundle))); }
  finally { await client.end(); }
}

module.exports = { readBundle, bootstrap };
if (require.main === module) main().catch((error) => {
  const safe = /^(Falta |Faltan |Paquete |Referencia |PDF de |La base |Guarda |DATABASE_URL |DB_SSL )/;
  console.error(safe.test(error.message) ? error.message : 'No se pudo importar la demo (' + (error.code || 'error') + ').');
  process.exitCode = 1;
});
