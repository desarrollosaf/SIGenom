import {
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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PUEDEN_OPERAR, Usuario, type UsuarioActual } from '../common/usuario-actual';
import {
  ActualizarEmpleadoDto,
  BajaDto,
  CrearEmpleadoDto,
  CuentaContableDto,
  DescuentoPlazoDto,
  FiltroEmpleadosDto,
  ImporteDto,
  PermisoDto,
  ReingresoDto,
} from './dto/empleado.dto';
import { EmpleadosService } from './empleados.service';
import { MovimientosService } from './movimientos.service';
import { QuincenaEmpleadoService } from './quincena-empleado.service';

class CurpDto {
  @Matches(/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z\d]\d$/i, { message: 'La CURP no tiene el formato correcto' })
  curp: string;
}

class SucursalBodyDto {
  @IsOptional() @IsInt() @Min(0) sucursal: number | null;
  @IsIn(['E', 'D']) tipo: string;
}

@Controller('empleados')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmpleadosController {
  constructor(
    private readonly empleados: EmpleadosService,
    private readonly movimientos: MovimientosService,
    private readonly quincena: QuincenaEmpleadoService,
  ) {}

  @Get()
  listar(@Query() filtro: FiltroEmpleadosDto) {
    return this.empleados.listar(filtro);
  }

  /** Su quincena en curso con todas las claves (sueldo, fijas, plazos, capturas, ISR, ISSEMYM). */
  @Get(':id/quincena')
  quincenaEnCurso(@Param('id', ParseIntPipe) id: number) {
    return this.quincena.estimar(id);
  }

  @Get(':id')
  ficha(@Param('id', ParseIntPipe) id: number) {
    return this.empleados.ficha(id);
  }

  @Post()
  @Roles(...PUEDEN_OPERAR)
  crear(@Body() dto: CrearEmpleadoDto, @Usuario() u: UsuarioActual) {
    return this.empleados.crear(dto, u.usuario);
  }

  @Patch(':id')
  @Roles(...PUEDEN_OPERAR)
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarEmpleadoDto, @Usuario() u: UsuarioActual) {
    return this.empleados.actualizar(id, dto, u.usuario);
  }

  @Put(':id/curp')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  curp(@Param('id', ParseIntPipe) id: number, @Body() dto: CurpDto, @Usuario() u: UsuarioActual) {
    return this.empleados.cambiarCurp(id, dto.curp, u.usuario);
  }

  @Put(':id/conceptos/:conceptoId')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  fijar(
    @Param('id', ParseIntPipe) id: number,
    @Param('conceptoId', ParseIntPipe) conceptoId: number,
    @Body() dto: ImporteDto,
    @Usuario() u: UsuarioActual,
  ) {
    return this.empleados.fijarConcepto(id, conceptoId, dto.importe, u.usuario);
  }

  @Delete(':id/conceptos/:conceptoId')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  quitar(@Param('id', ParseIntPipe) id: number, @Param('conceptoId', ParseIntPipe) conceptoId: number, @Usuario() u: UsuarioActual) {
    return this.empleados.quitarConcepto(id, conceptoId, u.usuario);
  }

  @Post(':id/descuentos')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  crearDescuento(@Param('id', ParseIntPipe) id: number, @Body() dto: DescuentoPlazoDto, @Usuario() u: UsuarioActual) {
    return this.empleados.guardarDescuento(id, dto, null, u.usuario);
  }

  @Put(':id/descuentos/:descuentoId')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  editarDescuento(
    @Param('id', ParseIntPipe) id: number,
    @Param('descuentoId', ParseIntPipe) descuentoId: number,
    @Body() dto: DescuentoPlazoDto,
    @Usuario() u: UsuarioActual,
  ) {
    return this.empleados.guardarDescuento(id, dto, descuentoId, u.usuario);
  }

  @Delete(':id/descuentos/:descuentoId')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  quitarDescuento(@Param('id', ParseIntPipe) id: number, @Param('descuentoId', ParseIntPipe) descuentoId: number, @Usuario() u: UsuarioActual) {
    return this.empleados.quitarDescuento(id, descuentoId, u.usuario);
  }

  @Put(':id/cuentas-contables')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  cuenta(@Param('id', ParseIntPipe) id: number, @Body() dto: CuentaContableDto, @Usuario() u: UsuarioActual) {
    return this.empleados.guardarCuenta(id, dto, u.usuario);
  }

  @Delete(':id/cuentas-contables/:cuentaId')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  quitarCuenta(@Param('id', ParseIntPipe) id: number, @Param('cuentaId', ParseIntPipe) cuentaId: number, @Usuario() u: UsuarioActual) {
    return this.empleados.quitarCuenta(id, cuentaId, u.usuario);
  }

  @Put(':id/sucursal')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  sucursal(@Param('id', ParseIntPipe) id: number, @Body() dto: SucursalBodyDto, @Usuario() u: UsuarioActual) {
    return this.empleados.guardarSucursal(id, dto.sucursal ?? null, dto.tipo, u.usuario);
  }

  @Post(':id/baja')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  baja(@Param('id', ParseIntPipe) id: number, @Body() dto: BajaDto, @Usuario() u: UsuarioActual) {
    return this.movimientos.baja(id, dto, u.usuario);
  }

  @Post(':id/permiso')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  permiso(@Param('id', ParseIntPipe) id: number, @Body() dto: PermisoDto, @Usuario() u: UsuarioActual) {
    return this.movimientos.permiso(id, dto, u.usuario);
  }

  @Post(':id/reingreso')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  reingreso(@Param('id', ParseIntPipe) id: number, @Body() dto: ReingresoDto, @Usuario() u: UsuarioActual) {
    return this.movimientos.reingreso(id, dto, u.usuario);
  }
}

@Controller('movimientos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MovimientosController {
  constructor(private readonly movimientos: MovimientosService) {}

  @Get()
  listar(
    @Query('tipo') tipo?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('tipoNomina') tipoNomina?: string,
  ) {
    return this.movimientos.listar({ tipo, desde, hasta, tipoNomina });
  }

  @Post(':id/cancelar')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelar(@Param('id', ParseIntPipe) id: number, @Usuario() u: UsuarioActual) {
    return this.movimientos.cancelar(id, u.usuario);
  }
}
