import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PDF_MAX_BYTES } from '../../config/file.config';
import { PdfUpload } from '../files/pdf-storage.service';
import { CreateTareaDto } from './dto/create-tarea.dto';
import { TareasService, TareaPublica } from './tareas.service';

@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TareasController {
  constructor(private readonly tareas: TareasService) {}

  @Get('cursos/:id/tareas')
  @ApiOperation({ summary: 'Lista tareas del curso accesible; oculta borradores al alumno' })
  list(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<TareaPublica[]> {
    return this.tareas.list(id, request.authUser);
  }

  @Get('tareas/:id')
  @ApiOperation({ summary: 'Consulta una tarea accesible' })
  detail(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<TareaPublica> {
    return this.tareas.detail(id, request.authUser);
  }

  @Post('cursos/:id/tareas')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: PDF_MAX_BYTES, files: 1 }, preservePath: true }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['titulo', 'descripcion', 'fechaLimite'], properties: {
    titulo: { type: 'string', maxLength: 200 }, descripcion: { type: 'string' },
    fechaLimite: { type: 'string', format: 'date-time' }, archivo: { type: 'string', format: 'binary' },
  } } })
  @ApiOperation({ summary: 'Publica una tarea en un curso propio' })
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() input: CreateTareaDto,
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: PdfUpload,
  ): Promise<TareaPublica> {
    return this.tareas.create(id, input, request.authUser, file);
  }

  @Get('tareas/:id/archivo')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Descarga el PDF de referencia de una tarea accesible' })
  async referenceFile(@Param('id', ParseIntPipe) id: number, @Req() request: AuthenticatedRequest): Promise<StreamableFile> {
    const data = await this.tareas.referenceFile(id, request.authUser);
    return new StreamableFile(data, {
      type: 'application/pdf', disposition: 'attachment; filename="referencia-tarea.pdf"',
    });
  }
}
