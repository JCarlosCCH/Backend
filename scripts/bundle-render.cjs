const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { readExport, readFiles } = require('./import-postgres.cjs');

const directory = path.join(process.env.LOCALAPPDATA, 'GestorTareas', 'Render');
const source = readExport(path.join(directory,'sqlserver-export.json'));
const files = readFiles(source,path.resolve(__dirname,'../storage'));
const json = JSON.stringify({ version:1, source, files:files.map((file) => ({name:file.name,content:file.content.toString('base64')})) });
const encoded = zlib.gzipSync(Buffer.from(json)).toString('base64');
if (Buffer.byteLength(encoded) >= 1000000) throw new Error('El paquete supera el límite de Secret Files de Render');
fs.writeFileSync(path.join(directory,'render-bootstrap.b64'),encoded,{mode:0o600});
console.log(JSON.stringify({bytes:Buffer.byteLength(encoded),pdf:files.length,privateFile:'%LOCALAPPDATA%\\GestorTareas\\Render\\render-bootstrap.b64'}));
