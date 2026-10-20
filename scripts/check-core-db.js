// Consulta SQL de solo lectura con la misma cuenta técnica que la API.
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const sql = require('mssql');
require('dotenv').config();

async function main() {
  const idTarea = Number(process.argv[2]);
  const idEntrega = Number(process.argv[3]);
  const source = process.argv[4];
  if (!Number.isSafeInteger(idTarea) || !Number.isSafeInteger(idEntrega) || !source) {
    throw new Error('Indique idTarea, idEntrega y ruta de PDF de comparación');
  }
  const config = {
    server: process.env.DB_HOST,
    database: 'GestorTareasDB', user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
      ...(process.env.DB_INSTANCE ? { instanceName: process.env.DB_INSTANCE } : {}) },
    ...(process.env.DB_PORT ? { port: Number(process.env.DB_PORT) } : {}),
  };
  const pool = await sql.connect(config);
  try {
    const result = await pool.request().input('task', sql.Int, idTarea).input('delivery', sql.Int, idEntrega).query(`
      SELECT t.IdTarea, t.Estado AS EstadoTarea, t.ArchivoReferencia,
             e.IdEntrega, e.Estado AS EstadoEntrega, e.Nota,
             e.ObservacionDocente, e.ArchivoUrl
      FROM dbo.Tarea t INNER JOIN dbo.Entrega e ON e.IdTarea = t.IdTarea
      WHERE t.IdTarea = @task AND e.IdEntrega = @delivery`);
    const row = result.recordset[0];
    if (!row || row.EstadoTarea !== 'PUBLICADA' || row.EstadoEntrega !== 'REVISADA' ||
      Number(row.Nota) !== 0 || row.ObservacionDocente !== 'Revisado en piloto') {
      throw new Error('El registro SQL no coincide con el recorrido');
    }
    const expected = createHash('sha256').update(readFileSync(source)).digest('hex');
    for (const name of [row.ArchivoReferencia, row.ArchivoUrl]) {
      if (!/^(task|submission)-[0-9a-f-]{36}\.pdf$/.test(name)) throw new Error('Referencia física no opaca');
      const path = join(process.cwd(), 'storage', name);
      if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) {
        throw new Error('Archivo privado ausente o diferente');
      }
    }
    const permissions = await pool.request().query(`
      SELECT
        HAS_PERMS_BY_NAME('dbo.Usuario', 'OBJECT', 'SELECT') AS UsuarioSelect,
        HAS_PERMS_BY_NAME('dbo.Docente', 'OBJECT', 'SELECT') AS DocenteSelect,
        HAS_PERMS_BY_NAME('dbo.Alumno', 'OBJECT', 'SELECT') AS AlumnoSelect,
        HAS_PERMS_BY_NAME('dbo.Curso', 'OBJECT', 'SELECT') AS CursoSelect,
        HAS_PERMS_BY_NAME('dbo.Matricula', 'OBJECT', 'SELECT') AS MatriculaSelect,
        HAS_PERMS_BY_NAME('dbo.Tarea', 'OBJECT', 'SELECT') AS TareaSelect,
        HAS_PERMS_BY_NAME('dbo.Entrega', 'OBJECT', 'SELECT') AS EntregaSelect,
        HAS_PERMS_BY_NAME('dbo.Tarea', 'OBJECT', 'INSERT') AS TareaInsert,
        HAS_PERMS_BY_NAME('dbo.Entrega', 'OBJECT', 'INSERT') AS EntregaInsert,
        HAS_PERMS_BY_NAME('dbo.Entrega', 'OBJECT', 'UPDATE', 'Nota', 'COLUMN') AS NotaUpdate,
        HAS_PERMS_BY_NAME('dbo.Entrega', 'OBJECT', 'UPDATE', 'ObservacionDocente', 'COLUMN') AS ObservacionUpdate,
        HAS_PERMS_BY_NAME('dbo.Entrega', 'OBJECT', 'UPDATE', 'Estado', 'COLUMN') AS EstadoUpdate,
        HAS_PERMS_BY_NAME('dbo.Entrega', 'OBJECT', 'DELETE') AS EntregaDelete,
        HAS_PERMS_BY_NAME('dbo.Tarea', 'OBJECT', 'DELETE') AS TareaDelete`);
    const values = Object.values(permissions.recordset[0]);
    if (values.slice(0, 12).some((value) => value !== 1) || values.slice(12).some((value) => value !== 0)) {
      throw new Error(`Permisos efectivos distintos de los autorizados: ${JSON.stringify(permissions.recordset[0])}`);
    }
    console.log(`SQL_REAL_OK=true TAREA=${row.IdTarea} ENTREGA=${row.IdEntrega} NOTA=${row.Nota} ESTADO=${row.EstadoEntrega}`);
    console.log('ARCHIVOS_PRIVADOS_EXISTEN=true SHA256_IGUAL=true PERMISOS_SELECT_7=true INSERT_2=true UPDATE_COLUMNAS_3=true DELETE=false');
  } finally { await pool.close(); }
}

main().catch((error) => { console.error(`SQL_REAL_FALLIDO=${error.message}`); process.exitCode = 1; });
