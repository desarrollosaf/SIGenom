import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  Adscripcion,
  Concepto,
  Motivo,
  Parametro,
  Puesto,
  TablaIsr,
  TablaSubsidio,
  Tabulador,
  TipoNomina,
} from './models/catalogos.models';
import { LecturaExterna, MovimientoExterno } from './models/externos.models';
import { Calculo, Captura, Periodo, PeriodoConcepto, Recibo, ReciboConcepto } from './models/nomina.models';
import {
  Bitacora,
  CuentaContable,
  DatosPersonales,
  DescuentoPlazo,
  Empleado,
  EmpleadoConcepto,
  MovimientoPersonal,
  SucursalBancaria,
} from './models/personal.models';
import { Usuario } from './models/usuario.model';

export const MODELOS = [
  Usuario,
  TipoNomina,
  Adscripcion,
  Puesto,
  Tabulador,
  Concepto,
  TablaIsr,
  TablaSubsidio,
  Motivo,
  Parametro,
  Empleado,
  DatosPersonales,
  EmpleadoConcepto,
  DescuentoPlazo,
  CuentaContable,
  SucursalBancaria,
  MovimientoPersonal,
  Bitacora,
  Periodo,
  Captura,
  Calculo,
  Recibo,
  ReciboConcepto,
  PeriodoConcepto,
  MovimientoExterno,
  LecturaExterna,
];

/** Deja los modelos disponibles para los módulos de dominio. */
@Module({
  imports: [SequelizeModule.forFeature(MODELOS)],
  exports: [SequelizeModule],
})
export class SigenomDbModule {}
