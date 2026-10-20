import { Module } from '@nestjs/common';
import { PdfStorageService } from './pdf-storage.service';

@Module({ providers: [PdfStorageService], exports: [PdfStorageService] })
export class FilesModule {}
