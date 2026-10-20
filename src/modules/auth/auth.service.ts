import { randomBytes } from 'node:crypto';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { Alumno } from '../usuarios/entities/alumno.entity';
import { Docente } from '../usuarios/entities/docente.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { LoginDto } from './dto/login.dto';
import { LoginResponse, PublicUser, UserRole } from './auth.types';
import { PasswordHasherService } from './password-hasher.service';
import { JWT_EXPIRES_IN } from './jwt.config';

@Injectable()
export class AuthService {
  private readonly missingUserHash: Promise<string>;

  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(Docente) private readonly docentes: Repository<Docente>,
    @InjectRepository(Alumno) private readonly alumnos: Repository<Alumno>,
    private readonly hasher: PasswordHasherService,
    private readonly jwt: JwtService,
  ) {
    this.missingUserHash = this.hasher.hash(randomBytes(32).toString('base64url'));
  }

  private async readDatabase<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch {
      throw new ServiceUnavailableException('Servicio de autenticación no disponible');
    }
  }

  private async roleFor(idUsuario: number): Promise<UserRole | null> {
    const [docente, alumno] = await this.readDatabase(() =>
      Promise.all([
        this.docentes.existsBy({ idDocente: idUsuario }),
        this.alumnos.existsBy({ idAlumno: idUsuario }),
      ]),
    );
    if (docente === alumno) return null;
    return docente ? 'DOCENTE' : 'ALUMNO';
  }

  private async publicUser(usuario: Usuario): Promise<PublicUser> {
    if (!usuario.estado) throw new UnauthorizedException('Credenciales no válidas');
    const rol = await this.roleFor(usuario.idUsuario);
    if (!rol) throw new UnauthorizedException('Credenciales no válidas');
    return {
      idUsuario: usuario.idUsuario,
      nombres: usuario.nombres,
      apellidos: usuario.apellidos,
      correo: usuario.correo,
      rol,
    };
  }

  async login(input: LoginDto): Promise<LoginResponse> {
    const usuario = await this.readDatabase(() =>
      this.usuarios
        .createQueryBuilder('usuario')
        .addSelect('usuario.contrasenaHash')
        .where('LOWER(usuario.correo) = LOWER(:correo)', { correo: input.correo })
        .getOne(),
    );
    const hash = usuario?.contrasenaHash ?? (await this.missingUserHash);
    let passwordMatches = false;
    try {
      passwordMatches = await this.hasher.verify(hash, input.contrasena);
    } catch {
      passwordMatches = false;
    }
    if (!usuario || !passwordMatches) throw new UnauthorizedException('Credenciales no válidas');
    const publicUser = await this.publicUser(usuario);
    const accessToken = await this.jwt.signAsync({ sub: publicUser.idUsuario });
    return { accessToken, tokenType: 'Bearer', expiresIn: JWT_EXPIRES_IN, usuario: publicUser };
  }

  async currentUser(idUsuario: number): Promise<PublicUser> {
    const usuario = await this.readDatabase(() => this.usuarios.findOneBy({ idUsuario }));
    if (!usuario) throw new UnauthorizedException('Credenciales no válidas');
    return this.publicUser(usuario);
  }
}
