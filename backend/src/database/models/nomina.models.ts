import { BelongsTo, Column, DataType, ForeignKey, HasMany, Model, Table } from 'sequelize-typescript';
import { Concepto } from './catalogos.models';
import { dinero, decimal } from './columnas';
import { Empleado } from './personal.models';

export type EstadoPeriodo = 'captura' | 'prenomina' | 'nomina' | 'cerrado';
export type TipoCalculo = 'prenomina' | 'nomina' | 'aguinaldo' | 'prima_vacacional';
export type EstadoCalculo = 'en_cola' | 'procesando' | 'terminado' | 'error' | 'reemplazado';

@Table({ tableName: 'periodos', underscored: true, timestamps: true })
export class Periodo extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column(DataType.STRING(1))
  declare tipoNomina: string;

  @Column(DataType.SMALLINT)
  declare anio: number;

  @Column(DataType.SMALLINT)
  declare quincena: number;

  @Column(DataType.DATEONLY)
  declare fechaInicio: string;

  @Column(DataType.DATEONLY)
  declare fechaFin: string;

  @Column(DataType.DATEONLY)
  declare fechaPago: string | null;

  @Column(DataType.STRING(10))
  declare estado: EstadoPeriodo;

  @Column(DataType.STRING(20))
  declare cerradoPor: string | null;

  @Column(DataType.DATE)
  declare cerradoEl: Date | null;
}

@Table({ tableName: 'capturas', underscored: true, timestamps: true })
export class Captura extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Periodo)
  @Column(DataType.INTEGER)
  declare periodoId: number;

  @ForeignKey(() => Empleado)
  @Column(DataType.INTEGER)
  declare empleadoId: number;

  @BelongsTo(() => Empleado)
  declare empleado: Empleado;

  @ForeignKey(() => Concepto)
  @Column(DataType.INTEGER)
  declare conceptoId: number;

  @BelongsTo(() => Concepto)
  declare concepto: Concepto;

  @Column(dinero('importe'))
  declare importe: number;

  @Column(DataType.STRING(20))
  declare origen: string;

  @Column(DataType.STRING(80))
  declare referencia: string | null;

  @Column(DataType.STRING(20))
  declare registradoPor: string;

  declare createdAt: Date;
}

@Table({ tableName: 'calculos', underscored: true, timestamps: true })
export class Calculo extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Periodo)
  @Column(DataType.INTEGER)
  declare periodoId: number;

  @BelongsTo(() => Periodo)
  declare periodo: Periodo;

  @Column(DataType.STRING(20))
  declare tipo: TipoCalculo;

  @Column(DataType.STRING(12))
  declare estado: EstadoCalculo;

  @Column(DataType.INTEGER)
  declare totalEmpleados: number;

  @Column(DataType.INTEGER)
  declare procesados: number;

  @Column(dinero('totalPercepciones'))
  declare totalPercepciones: number;

  @Column(dinero('totalDeducciones'))
  declare totalDeducciones: number;

  @Column(dinero('totalNeto'))
  declare totalNeto: number;

  @Column(DataType.TEXT)
  declare error: string | null;

  @Column(DataType.STRING(20))
  declare solicitadoPor: string;

  @Column(DataType.DATE)
  declare iniciadoEl: Date | null;

  @Column(DataType.DATE)
  declare terminadoEl: Date | null;

  declare createdAt: Date;
}

@Table({ tableName: 'recibos', underscored: true, timestamps: true, updatedAt: false })
export class Recibo extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Calculo)
  @Column(DataType.INTEGER)
  declare calculoId: number;

  @BelongsTo(() => Calculo)
  declare calculo: Calculo;

  @ForeignKey(() => Empleado)
  @Column(DataType.INTEGER)
  declare empleadoId: number;

  @Column(DataType.STRING(170))
  declare nombre: string;

  @Column(DataType.STRING(18))
  declare curp: string;

  @Column(DataType.STRING(13))
  declare rfc: string;

  @Column(DataType.INTEGER)
  declare adscripcionId: number;

  @Column(DataType.STRING(12))
  declare puestoClave: string;

  @Column(DataType.SMALLINT)
  declare nivel: number;

  @Column(DataType.SMALLINT)
  declare rango: number;

  @Column(decimal('dias', 5, 2))
  declare dias: number;

  @Column(dinero('baseIsr'))
  declare baseIsr: number;

  @Column(dinero('baseIssemym'))
  declare baseIssemym: number;

  @Column(dinero('isrCausado'))
  declare isrCausado: number;

  @Column(dinero('subsidio'))
  declare subsidio: number;

  @Column(dinero('totalPercepciones'))
  declare totalPercepciones: number;

  @Column(dinero('totalDeducciones'))
  declare totalDeducciones: number;

  @Column(dinero('neto'))
  declare neto: number;

  @Column(DataType.STRING(18))
  declare cuentaBancaria: string | null;

  @Column(DataType.BOOLEAN)
  declare pagoCheque: boolean;

  @Column(DataType.JSONB)
  declare observaciones: string[] | null;

  @HasMany(() => ReciboConcepto)
  declare conceptos: ReciboConcepto[];
}

@Table({ tableName: 'recibo_conceptos', underscored: true, timestamps: false })
export class ReciboConcepto extends Model {
  @Column({ type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Recibo)
  @Column(DataType.INTEGER)
  declare reciboId: number;

  @ForeignKey(() => Concepto)
  @Column(DataType.INTEGER)
  declare conceptoId: number;

  @Column(DataType.SMALLINT)
  declare clave: number;

  @Column(DataType.STRING(60))
  declare descripcion: string;

  @Column(DataType.STRING(1))
  declare naturaleza: 'P' | 'D';

  @Column(dinero('importe'))
  declare importe: number;

  @Column(dinero('gravadoIsr'))
  declare gravadoIsr: number;

  @Column(DataType.STRING(16))
  declare partida: string | null;
}
