import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PUEDEN_OPERAR, ROL_ADMINISTRADOR, Usuario, type UsuarioActual } from '../common/usuario-actual';
import type { TipoCalculo } from '../database/models/nomina.models';
import { CalculosService } from './calculos.service';
import { CapturasService, ORIGENES } from './capturas.service';
import type { Origen } from './capturas.service';
import { PeriodosService } from './periodos.service';
import { ReciboPdfService } from './recibo-pdf.service';

class CrearPeriodoDto {
  @IsString() @MaxLength(1) tipoNomina: string;
  @IsInt() @Min(2000) @Max(2100) anio: number;
  @IsInt() @Min(1) @Max(24) quincena: number;
  @IsOptional() @IsDateString() fechaPago?: string;
}

class FechaPagoDto {
  @IsDateString() fechaPago: string;
}

class CapturaDto {
  @IsInt() empleadoId: number;
  @IsInt() conceptoId: number;
  @IsNumber({ maxDecimalPlaces: 2 }) importe: number;
  @IsOptional() @IsString() @MaxLength(80) referencia?: string;
}

class CalcularDto {
  @IsIn(['prenomina', 'nomina', 'aguinaldo', 'prima_vacacional']) tipo: TipoCalculo;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuincenaController {
  constructor(
    private readonly periodos: PeriodosService,
    private readonly capturas: CapturasService,
    private readonly calculos: CalculosService,
    private readonly pdf: ReciboPdfService,
  ) {}

  // --- Periodos -----------------------------------------------------------------------------

  @Get('periodos')
  listar(@Query('tipoNomina') tipoNomina: string, @Query('anio') anio?: string) {
    if (!tipoNomina) throw new BadRequestException('Indica el tipo de nómina');
    return this.periodos.listar(tipoNomina, anio ? Number(anio) : undefined);
  }

  @Get('periodos/actual')
  actual(@Query('tipoNomina') tipoNomina: string) {
    return this.periodos.actual(tipoNomina);
  }

  @Get('periodos/:id')
  ver(@Param('id', ParseIntPipe) id: number) {
    return this.periodos.ver(id);
  }

  @Post('periodos')
  @Roles(...PUEDEN_OPERAR)
  crear(@Body() dto: CrearPeriodoDto, @Usuario() u: UsuarioActual) {
    return this.periodos.crear(dto, u.usuario);
  }

  @Patch('periodos/:id')
  @Roles(...PUEDEN_OPERAR)
  fechaPago(@Param('id', ParseIntPipe) id: number, @Body() dto: FechaPagoDto, @Usuario() u: UsuarioActual) {
    return this.periodos.cambiarFechaPago(id, dto.fechaPago, u.usuario);
  }

  @Post('periodos/:id/cerrar')
  @Roles(ROL_ADMINISTRADOR)
  cerrar(@Param('id', ParseIntPipe) id: number, @Usuario() u: UsuarioActual) {
    return this.periodos.cerrar(id, u.usuario);
  }

  // --- Captura quincenal --------------------------------------------------------------------

  @Get('capturas/origenes')
  origenes() {
    return Object.entries(ORIGENES).map(([clave, nombre]) => ({ clave, nombre }));
  }

  @Get('periodos/:id/capturas')
  listarCapturas(@Param('id', ParseIntPipe) id: number, @Query('empleadoId') empleadoId?: string) {
    return this.capturas.listar(id, empleadoId ? Number(empleadoId) : undefined);
  }

  @Post('periodos/:id/capturas')
  @Roles(...PUEDEN_OPERAR)
  capturar(@Param('id', ParseIntPipe) id: number, @Body() dto: CapturaDto, @Usuario() u: UsuarioActual) {
    return this.capturas.crear(id, dto, u.usuario);
  }

  @Post('periodos/:id/capturas/importar')
  @Roles(...PUEDEN_OPERAR)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importar(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @Body('origen') origen: Origen,
    @Usuario() u: UsuarioActual,
  ) {
    if (!archivo) throw new BadRequestException('Adjunta el archivo CSV.');
    return this.capturas.importar(id, decodificar(archivo.buffer), origen ?? 'otro', u.usuario);
  }

  @Delete('capturas/:id')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  borrarCaptura(@Param('id', ParseIntPipe) id: number, @Usuario() u: UsuarioActual) {
    return this.capturas.eliminar(id, u.usuario);
  }

  // --- Cálculo y recibos --------------------------------------------------------------------

  @Post('periodos/:id/calcular')
  @Roles(...PUEDEN_OPERAR)
  calcular(@Param('id', ParseIntPipe) id: number, @Body() dto: CalcularDto, @Usuario() u: UsuarioActual) {
    return this.calculos.solicitar(id, dto.tipo, u.usuario);
  }

  @Get('calculos/:id')
  calculo(@Param('id', ParseIntPipe) id: number) {
    return this.calculos.ver(id);
  }

  @Get('calculos/:id/recibos')
  recibos(
    @Param('id', ParseIntPipe) id: number,
    @Query('q') q?: string,
    @Query('desde') desde?: string,
    @Query('limite') limite?: string,
    @Query('observados') observados?: string,
  ) {
    return this.calculos.recibos(id, { q, desde: Number(desde) || 0, limite: Number(limite) || 50, soloObservados: observados === 'true' });
  }

  @Get('calculos/:id/recibos.pdf')
  async recibosPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="comprobantes-${id}.pdf"`);
    res.send(await this.pdf.todos(id));
  }

  @Get('recibos/:id')
  recibo(@Param('id', ParseIntPipe) id: number) {
    return this.calculos.recibo(id);
  }

  @Get('recibos/:id/pdf')
  async reciboPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(await this.pdf.uno(id));
  }
}

/** Los archivos que salen de Excel en Windows suelen venir en Latin-1, no en UTF-8. */
function decodificar(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('�') ? buffer.toString('latin1') : utf8.replace(/^﻿/, '');
}
