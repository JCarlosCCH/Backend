import { Body, Controller, Get, Header, Param, ParseIntPipe, Patch, Post, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { PDF_MAX_BYTES } from '../../config/file.config';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PdfUpload } from '../files/pdf-storage.service';
import { CreateEntregaDto } from './dto/create-entrega.dto';
import { CalificarEntregaDto } from './dto/calificar-entrega.dto';
import { EntregasService, EntregaPublica, EntregaListado } from './entregas.service';

@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EntregasController {
  constructor(private readonly entregas: EntregasService) {}

  @Post('tareas/:id/entregas')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: PDF_MAX_BYTES, files: 1 }, preservePath: true }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo'], properties: {
    comentario: { type: 'string', maxLength: 500 }, archivo: { type: 'string', format: 'binary' },
  } } })
  @ApiOperation({ summary: 'Registra un PDF de entrega propio antes del límite' })
  submit(
    @Param('id', ParseIntPipe) id: number, @Body() input: CreateEntregaDto,
    @UploadedFile() file: PdfUpload | undefined, @Req() request: AuthenticatedRequest,
  ): Promise<EntregaPublica> {
    return this.entregas.submit(id, input, file, request.authUser);
  }

  @Get('tareas/:id/mi-entrega')
  @ApiOperation({ summary: 'Consulta la entrega propia o null si no existe' })
  mine(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<{ entrega: EntregaPublica | null }> {
    return this.entregas.mine(id, request.authUser);
  }

  @Get('tareas/:id/entregas')
  @ApiOperation({ summary: 'Lista entregas de una tarea del docente responsable' })
  @ApiOkResponse({ description: 'Conserva los campos de entrega y añade nombresAlumno y apellidosAlumno desde el usuario del alumno; solo para el docente responsable.' })
  list(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<EntregaListado[]> {
    return this.entregas.list(id, request.authUser);
  }

  @Get('entregas/:id/archivo')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Descarga un PDF de entrega autorizado' })
  async download(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<StreamableFile> {
    const data = await this.entregas.download(id, request.authUser);
    return new StreamableFile(data, { type: 'application/pdf', disposition: 'attachment; filename="entrega.pdf"' });
  }

  @Patch('entregas/:id/calificacion')
  @ApiOperation({ summary: 'Califica una entrega del curso propio con nota de 0 a 20' })
  grade(
    @Param('id', ParseIntPipe) id: number, @Body() input: CalificarEntregaDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<EntregaPublica> {
    return this.entregas.grade(id, input, request.authUser);
  }
}
