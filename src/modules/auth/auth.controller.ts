import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginResponse, PublicUser } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Inicia sesión con una cuenta habilitada' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    schema: {
      example: {
        accessToken: '<token>', tokenType: 'Bearer', expiresIn: 1800,
        usuario: { idUsuario: 1, nombres: 'Docente', apellidos: 'Ejemplo', correo: 'docente@example.test', rol: 'DOCENTE' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Credenciales no válidas' })
  @ApiTooManyRequestsResponse({ description: 'Límite de intentos alcanzado' })
  login(@Body() input: LoginDto): Promise<LoginResponse> {
    return this.auth.login(input);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtiene el usuario autenticado y su perfil vigente' })
  @ApiOkResponse({
    schema: { example: { idUsuario: 1, nombres: 'Docente', apellidos: 'Ejemplo', correo: 'docente@example.test', rol: 'DOCENTE' } },
  })
  @ApiUnauthorizedResponse({ description: 'Autenticación requerida o cuenta no habilitada' })
  me(@Req() request: AuthenticatedRequest): PublicUser {
    return request.authUser;
  }
}
