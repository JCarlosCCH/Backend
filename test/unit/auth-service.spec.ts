import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AuthService } from '../../src/modules/auth/auth.service';
import { LoginDto } from '../../src/modules/auth/dto/login.dto';
import { PasswordHasherService } from '../../src/modules/auth/password-hasher.service';
import { Alumno } from '../../src/modules/usuarios/entities/alumno.entity';
import { Docente } from '../../src/modules/usuarios/entities/docente.entity';
import { Usuario } from '../../src/modules/usuarios/entities/usuario.entity';

const hasher = new PasswordHasherService();
const PASSWORD = 'contrasena-valida-123';
const LOGIN: LoginDto = { correo: 'docente@example.test', contrasena: PASSWORD };


describe('Autenticación en el servicio', () => {
  let hash = '';
  let service: AuthService;
  let usuarios: Record<string, unknown>;
  let docenteIds: number[];
  let alumnoIds: number[];
  let signAsync: jest.Mock;

  beforeAll(async () => { hash = await hasher.hash(PASSWORD); });

  function build(users: Usuario[]) {
    usuarios = {
      createQueryBuilder: () => ({
        addSelect() { return this; },
        where(_sql: string, params: { correo: string }) {
          return { getOne: async () => users.find((user) => user.correo === params.correo) ?? null };
        },
      }),
      findOneBy: async ({ idUsuario }: { idUsuario: number }) =>
        users.find((user) => user.idUsuario === idUsuario) ?? null,
    };
    signAsync = jest.fn(async () => 'token-firmado');
    service = new AuthService(
      usuarios as unknown as Repository<Usuario>,
      { existsBy: async ({ idDocente }: { idDocente: number }) => docenteIds.includes(idDocente) } as unknown as Repository<Docente>,
      { existsBy: async ({ idAlumno }: { idAlumno: number }) => alumnoIds.includes(idAlumno) } as unknown as Repository<Alumno>,
      hasher,
      { signAsync } as unknown as JwtService,
    );
  }

  const activeTeacher = () => ({
    idUsuario: 21, nombres: 'Docente', apellidos: 'Prueba', correo: 'docente@example.test',
    estado: true, contrasenaHash: hash,
  });

  beforeEach(() => {
    docenteIds = [21];
    alumnoIds = [];
    build([activeTeacher()] as Usuario[]);
  });

  it('acepta credenciales válidas y devuelve el perfil sin ContrasenaHash', async () => {
    const result = await service.login(LOGIN);
    expect(result).toMatchObject({
      accessToken: 'token-firmado', tokenType: 'Bearer', expiresIn: 1800,
      usuario: { idUsuario: 21, rol: 'DOCENTE', correo: 'docente@example.test' },
    });
    expect(signAsync).toHaveBeenCalledWith({ sub: 21 });
    expect(JSON.stringify(result)).not.toContain('contrasenaHash');
  });

  it('asigna rol ALUMNO cuando el perfil es de alumno', async () => {
    docenteIds = [];
    alumnoIds = [21];
    const result = await service.login(LOGIN);
    expect(result.usuario.rol).toBe('ALUMNO');
  });

  it('rechaza la contraseña incorrecta con 401 genérico', async () => {
    await expect(service.login({ ...LOGIN, contrasena: 'otra-clave' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('rechaza un usuario inexistente con el mismo 401', async () => {
    await expect(service.login({ ...LOGIN, correo: 'nadie@example.test' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza una cuenta inactiva aunque la contraseña sea correcta', async () => {
    build([{ ...activeTeacher(), estado: false }] as Usuario[]);
    await expect(service.login(LOGIN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un usuario sin perfil definido', async () => {
    docenteIds = [];
    await expect(service.login(LOGIN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un usuario con ambos perfiles por inconsistente', async () => {
    alumnoIds = [21];
    await expect(service.login(LOGIN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('currentUser devuelve el perfil vigente', async () => {
    await expect(service.currentUser(21)).resolves.toMatchObject({ idUsuario: 21, rol: 'DOCENTE' });
  });

  it('currentUser rechaza a un usuario desaparecido', async () => {
    build([] as Usuario[]);
    await expect(service.currentUser(21)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('convierte un fallo de base en 503 sin filtrar detalles', async () => {
    const failing = {
      createQueryBuilder: () => ({
        addSelect() { return this; },
        where() { return { getOne: async () => { throw new Error('detalle privado SQL'); } }; },
      }),
      findOneBy: async () => { throw new Error('detalle privado SQL'); },
    };
    service = new AuthService(
      failing as unknown as Repository<Usuario>,
      {} as Repository<Docente>,
      {} as Repository<Alumno>,
      hasher,
      { signAsync } as unknown as JwtService,
    );
    await expect(service.login(LOGIN)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
