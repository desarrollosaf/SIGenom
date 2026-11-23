import { Body, Controller, Module, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROL_ADMINISTRADOR, Usuario, type UsuarioActual } from '../common/usuario-actual';
import { ProcesosService } from './procesos.service';

class AumentoDto {
  @IsNumber() @Min(0.01) @Max(100) porcentaje: number;
  @IsOptional() @IsArray() @IsInt({ each: true }) niveles?: number[];
  @IsOptional() @IsBoolean() incluirCompensacion?: boolean;
  /** Desde cuándo vale el tabulador nuevo; por omisión, hoy. */
  @IsOptional() @IsDateString() vigencia?: string;
}

class FijoSimuladoDto {
  @IsInt() conceptoId: number;
  @IsNumber() importe: number;
}

class SimularDto {
  @IsString() tipoNomina: string;
  @IsInt() @Min(1) nivel: number;
  @IsInt() @Min(1) rango: number;
  @IsOptional() @IsNumber() @Min(0) @Max(15) dias?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FijoSimuladoDto) fijos?: FijoSimuladoDto[];
}

@Controller('procesos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProcesosController {
  constructor(private readonly procesos: ProcesosService) {}

  @Post('aumento-salarial/vista-previa')
  vistaPrevia(@Body() dto: AumentoDto) {
    return this.procesos.vistaPrevia(dto);
  }

  @Post('aumento-salarial')
  @Roles(ROL_ADMINISTRADOR)
  aplicar(@Body() dto: AumentoDto, @Usuario() u: UsuarioActual) {
    return this.procesos.aplicarAumento(dto, u.usuario);
  }

  @Post('simulador')
  simular(@Body() dto: SimularDto) {
    return this.procesos.simular(dto);
  }
}

@Module({
  controllers: [ProcesosController],
  providers: [ProcesosService],
})
export class ProcesosModule {}
