import { resolve } from 'node:path';

// Límites técnicos del piloto local, ajustables antes de un despliegue institucional.
export const PDF_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_MIME = 'application/pdf';
export const PRIVATE_FILE_DIRECTORY = resolve(process.cwd(), 'storage');
