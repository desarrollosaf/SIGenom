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
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PUEDEN_OPERAR, ROL_ADMINISTRADOR, Usuario, type UsuarioActual } from '../common/usuario-actual';
import type { TipoCalculo } from '../database/models/nomina.models';
import { CalculosService } from './calculos.service';
import { AjusteNetoService } from './ajuste-neto.service';
import { CapturasService, ORIGENES, ORIGENES_SISTEMA } from './capturas.service';
import type { Origen } from './capturas.service';
import { PeriodosService } from './periodos.service';
import { ReciboPdfService } from './recibo-pdf.service';
import { RetroactivoService } from './retroactivo.service';

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

class AjusteDto {
  @IsInt() conceptoId: number;
  /** null = como diga el catálogo. */
  @ValidateIf((o) => o.gravaIsr !== null) @IsBoolean() gravaIsr: boolean | null;
  @ValidateIf((o) => o.timbra !== null) @IsBoolean() timbra: boolean | null;
  @IsOptional() @IsString() @MaxLength(200) motivo?: string;
}

class ProbarAjusteDto {
  @IsInt() empleadoId: number;
  @IsInt() conceptoId: number;
  /** Sin importe, se busca el mínimo que deja el neto en `objetivo`. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) importe?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000) objetivo?: number;
}

class AplicarAjusteDto {
  @IsInt() empleadoId: number;
  @IsInt() conceptoId: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) importe: number;
  @IsOptional() @IsString() @MaxLength(80) motivo?: string;
}

class RetroactivoDto {
  @IsDateString() desde: string;
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
    private readonly ajusteNeto: AjusteNetoService,
    private readonly retroactivo: RetroactivoService,
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

  @Get('periodos/:id/ajustes')
  ajustes(@Param('id', ParseIntPipe) id: number) {
    return this.periodos.listarAjustes(id);
  }

  @Post('periodos/:id/ajustes')
  @Roles(...PUEDEN_OPERAR)
  ajustar(@Param('id', ParseIntPipe) id: number, @Body() dto: AjusteDto, @Usuario() u: UsuarioActual) {
    return this.periodos.guardarAjuste(id, { ...dto, gravaIsr: dto.gravaIsr ?? null, timbra: dto.timbra ?? null }, u.usuario);
  }

  // --- Captura quincenal --------------------------------------------------------------------

  @Get('capturas/origenes')
  origenes() {
    const lista = (o: Record<string, string>, sistema: boolean) => Object.entries(o).map(([clave, nombre]) => ({ clave, nombre, sistema }));
    return [...lista(ORIGENES, false), ...lista(ORIGENES_SISTEMA, true)];
  }

  @Get('periodos/:id/capturas')
  listarCapturas(
    @Param('id', ParseIntPipe) id: number,
    @Query('empleadoId') empleadoId?: string,
    @Query('origen') origen?: string,
    @Query('q') q?: string,
    @Query('limite') limite?: string,
  ) {
    return this.capturas.listar(id, { empleadoId: empleadoId ? Number(empleadoId) : undefined, origen, q, limite: limite ? Number(limite) : undefined });
  }

  /** Totales de lo capturado (de todo, no solo de lo que cabe en la lista). */
  @Get('periodos/:id/capturas/resumen')
  resumenCapturas(
    @Param('id', ParseIntPipe) id: number,
    @Query('empleadoId') empleadoId?: string,
    @Query('origen') origen?: string,
    @Query('q') q?: string,
    @Query('desde') desde?: string | string[],
  ) {
    return this.capturas.resumen(id, {
      empleadoId: empleadoId ? Number(empleadoId) : undefined,
      origen,
      q,
      desde: desde === undefined ? [] : Array.isArray(desde) ? desde : [desde],
    });
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

  // --- Ajuste de neto y retroactivo ---------------------------------------------------------

  @Get('periodos/:id/ajuste-neto/:empleadoId')
  verAjusteNeto(@Param('id', ParseIntPipe) id: number, @Param('empleadoId', ParseIntPipe) empleadoId: number) {
    return this.ajusteNeto.ver(id, empleadoId);
  }

  @Post('periodos/:id/ajuste-neto/probar')
  @HttpCode(HttpStatus.OK)
  probarAjusteNeto(@Param('id', ParseIntPipe) id: number, @Body() dto: ProbarAjusteDto) {
    return this.ajusteNeto.probar(id, dto);
  }

  @Post('periodos/:id/ajuste-neto')
  @Roles(...PUEDEN_OPERAR)
  aplicarAjusteNeto(@Param('id', ParseIntPipe) id: number, @Body() dto: AplicarAjusteDto, @Usuario() u: UsuarioActual) {
    return this.ajusteNeto.aplicar(id, dto, u.usuario);
  }

  @Post('periodos/:id/retroactivo/vista-previa')
  @HttpCode(HttpStatus.OK)
  vistaRetroactivo(@Param('id', ParseIntPipe) id: number, @Body() dto: RetroactivoDto) {
    return this.retroactivo.vista(id, dto.desde.slice(0, 10));
  }

  @Post('periodos/:id/retroactivo')
  @Roles(...PUEDEN_OPERAR)
  aplicarRetroactivo(@Param('id', ParseIntPipe) id: number, @Body() dto: RetroactivoDto, @Usuario() u: UsuarioActual) {
    return this.retroactivo.aplicar(id, dto.desde.slice(0, 10), u.usuario);
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
