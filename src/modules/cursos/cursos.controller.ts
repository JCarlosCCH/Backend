import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CursosService, CursoPublico } from './cursos.service';

@Controller('cursos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CursosController {
  constructor(private readonly cursos: CursosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista únicamente los cursos accesibles al usuario' })
  list(@Req() request: AuthenticatedRequest): Promise<CursoPublico[]> {
    return this.cursos.list(request.authUser);
  }
}
