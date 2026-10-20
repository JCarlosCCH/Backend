import { ServiceUnavailableException } from '@nestjs/common';
import { PdfStorageService, PdfUpload } from '../../src/modules/files/pdf-storage.service';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\n0\n%%EOF');
const upload: PdfUpload = { originalname: 'trabajo.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf };

describe('Almacenamiento real de PDF: guardar, leer y eliminar', () => {
  const storage = new PdfStorageService();
  let stored: string | undefined;

  afterEach(async () => {
    if (stored) { await storage.remove(stored); stored = undefined; }
  });

  it('store escribe el archivo, read devuelve el contenido y remove lo retira', async () => {
    stored = await storage.store(upload, 'submission');
    expect(stored).toMatch(/^submission-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/);
    const content = await storage.read(stored);
    expect(content.equals(upload.buffer)).toBe(true);
    await storage.remove(stored);
    await expect(storage.read(stored)).rejects.toBeInstanceOf(ServiceUnavailableException);
    stored = undefined;
  });

  it('read rechaza nombres que no corresponden al esquema interno', async () => {
    await expect(storage.read('trabajo.pdf')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(storage.read('../secreto.pdf')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('remove ignora silenciosamente nombres malformados', async () => {
    await expect(storage.remove('no-existe.pdf')).resolves.toBeUndefined();
  });
});
