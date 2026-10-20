import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BadRequestException, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PDF_MAX_BYTES, PDF_MIME, PRIVATE_FILE_DIRECTORY } from '../../config/file.config';

export interface PdfUpload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class PdfStorageService {
  constructor(@Optional() @InjectDataSource() private readonly database?: DataSource) {}

  private get usesPostgres(): boolean { return this.database?.options.type === 'postgres'; }

  validate(file: PdfUpload | undefined): asserts file is PdfUpload {
    if (!file || !Buffer.isBuffer(file.buffer) || file.size === 0 || file.buffer.length === 0) {
      throw new BadRequestException('Se requiere un PDF no vacío');
    }
    if (file.size > PDF_MAX_BYTES || file.buffer.length > PDF_MAX_BYTES) {
      throw new BadRequestException('El PDF supera 10 MiB');
    }
    if (!file.originalname || basename(file.originalname) !== file.originalname ||
      /[\\/]/.test(file.originalname) || file.originalname.includes(String.fromCharCode(0)) ||
      file.originalname.includes('..') ||
      !/\.pdf$/i.test(file.originalname) || file.mimetype !== PDF_MIME) {
      throw new BadRequestException('Nombre o tipo de archivo no admitido');
    }
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      !file.buffer.subarray(-1024).includes(Buffer.from('%%EOF'))) {
      throw new BadRequestException('El contenido no corresponde a un PDF válido para el piloto');
    }
  }

  async store(file: PdfUpload, kind: 'task' | 'submission'): Promise<string> {
    this.validate(file);
    const name = `${kind}-${randomUUID()}.pdf`;
    if (this.usesPostgres) {
      try {
        await this.database!.query('INSERT INTO dbo."Archivo" ("Nombre", "Contenido") VALUES ($1, $2)', [name, file.buffer]);
        return name;
      } catch { throw new ServiceUnavailableException('No se pudo guardar el archivo'); }
    }
    const path = join(PRIVATE_FILE_DIRECTORY, name);
    let created = false;
    try {
      await mkdir(PRIVATE_FILE_DIRECTORY, { recursive: true });
      const handle = await open(path, 'wx');
      created = true;
      try { await handle.writeFile(file.buffer); }
      finally { await handle.close(); }
    } catch {
      if (created) {
        try { await unlink(path); } catch { /* No se expone la ruta física. */ }
      }
      throw new ServiceUnavailableException('No se pudo guardar el archivo');
    }
    return name;
  }

  async read(name: string): Promise<Buffer> {
    if (!/^(task|submission)-[0-9a-f-]{36}\.pdf$/.test(name)) {
      throw new ServiceUnavailableException('Archivo no disponible');
    }
    if (this.usesPostgres) {
      try {
        const rows: Array<{ Contenido: Buffer }> = await this.database!.query('SELECT "Contenido" FROM dbo."Archivo" WHERE "Nombre" = $1', [name]);
        if (rows.length !== 1 || !Buffer.isBuffer(rows[0].Contenido)) throw new Error('Archivo ausente');
        return rows[0].Contenido;
      } catch { throw new ServiceUnavailableException('Archivo no disponible'); }
    }
    try { return await readFile(join(PRIVATE_FILE_DIRECTORY, name)); }
    catch { throw new ServiceUnavailableException('Archivo no disponible'); }
  }

  async remove(name: string): Promise<void> {
    if (!/^(task|submission)-[0-9a-f-]{36}\.pdf$/.test(name)) return;
    if (this.usesPostgres) {
      try { await this.database!.query('DELETE FROM dbo."Archivo" WHERE "Nombre" = $1', [name]); }
      catch { /* Compensa un archivo recién guardado cuando falla la entrega. */ }
      return;
    }
    try { await unlink(join(PRIVATE_FILE_DIRECTORY, name)); }
    catch { /* La operación SQL ya falló; no se expone la ruta física. */ }
  }
}
