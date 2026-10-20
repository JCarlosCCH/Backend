export type UserRole = 'DOCENTE' | 'ALUMNO';

export interface PublicUser {
  idUsuario: number;
  nombres: string;
  apellidos: string;
  correo: string;
  rol: UserRole;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: 1800;
  usuario: PublicUser;
}
