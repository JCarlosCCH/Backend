import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CalificarEntregaDto {
  @ApiProperty({ minimum: 0, maximum: 20, multipleOf: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(20)
  nota!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacionDocente?: string;
}
