import { Body, Controller, Get, HttpCode, HttpStatus, Module, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PUEDEN_OPERAR, Usuario, type UsuarioActual } from '../common/usuario-actual';
import { EmpleadosModule } from '../empleados/empleados.module';
import { QuincenaModule } from '../quincena/quincena.module';
import { IntegracionesService } from './integraciones.service';

class IdsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsInt({ each: true }) ids: number[];
}

class DescartarDto extends IdsDto {
  @IsString() @MinLength(3) @MaxLength(200) motivo: string;
  @IsOptional() @IsBoolean() hecho?: boolean;
}

class ClaveAjusteDto {
  @IsInt() @Min(1) @Max(999) clave: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) importe: number;
  @IsIn(['quincena', 'esta']) cada: 'quincena' | 'esta';
}

class AjustesDto {
  @IsOptional() @IsString() @MaxLength(20) banco?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(/^(\d{10}|\d{11}|\d{16}|\d{18})$/, { message: 'La cuenta debe ser de 10, 11, 16 o 18 dígitos' }) cuentaBancaria?: string | null;
  @IsOptional() @IsBoolean() pagoCheque?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ClaveAjusteDto) claves?: ClaveAjusteDto[];
}

@Controller('otros-sistemas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IntegracionesController {
  constructor(private readonly integraciones: IntegracionesService) {}

  @Get()
  resumen() {
    return this.integraciones.resumen();
  }

  @Get(':sistema')
  listar(@Param('sistema') sistema: string, @Query('estado') estado?: string, @Query('tipo') tipo?: string, @Query('q') q?: string, @Query('desde') desde?: string) {
    return this.integraciones.listar(sistema, { estado, tipo, q, desde: Math.max(0, Number(desde) || 0) });
  }

  @Post(':sistema/traer')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.OK)
  traer(@Param('sistema') sistema: string, @Usuario() u: UsuarioActual) {
    return this.integraciones.traer(sistema, u.usuario);
  }

  @Post(':sistema/aplicar')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.OK)
  aplicar(@Param('sistema') sistema: string, @Body() dto: IdsDto, @Usuario() u: UsuarioActual) {
    return this.integraciones.aplicar(sistema, dto.ids, u.usuario);
  }

  @Post(':sistema/descartar')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.OK)
  descartar(@Param('sistema') sistema: string, @Body() dto: DescartarDto, @Usuario() u: UsuarioActual) {
    return this.integraciones.descartar(sistema, dto.ids, dto.motivo.trim(), u.usuario, dto.hecho);
  }

  @Get(':sistema/:id/recibo')
  recibo(@Param('sistema') sistema: string, @Param('id', ParseIntPipe) id: number) {
    return this.integraciones.recibo(sistema, id);
  }

  @Put(':sistema/:id/ajustes')
  @Roles(...PUEDEN_OPERAR)
  ajustar(@Param('sistema') sistema: string, @Param('id', ParseIntPipe) id: number, @Body() dto: AjustesDto, @Usuario() u: UsuarioActual) {
    return this.integraciones.ajustar(sistema, id, dto, u.usuario);
  }

  @Post(':sistema/:id/restaurar')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  restaurar(@Param('sistema') sistema: string, @Param('id', ParseIntPipe) id: number, @Usuario() u: UsuarioActual) {
    return this.integraciones.restaurar(sistema, id, u.usuario);
  }
}

@Module({
  imports: [EmpleadosModule, QuincenaModule],
  controllers: [IntegracionesController],
  providers: [IntegracionesService],
})
export class IntegracionesModule {}
