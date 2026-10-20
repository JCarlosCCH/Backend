import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'docente@example.test', maxLength: 150 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(150)
  correo!: string;

  @ApiProperty({ format: 'password', maxLength: 256 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  contrasena!: string;
}
