import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  HasOne,
  Model,
  Table,
} from 'sequelize-typescript';
import { Adscripcion, Concepto, Motivo, Puesto } from './catalogos.models';
import { decimal, dinero } from './columnas';

export type EstadoEmpleado = 'activo' | 'permiso' | 'baja';

@Table({ tableName: 'empleados', underscored: true, timestamps: true })
export class Empleado extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column(DataType.STRING(18))
  declare curp: string;

  @Column(DataType.STRING(13))
  declare rfc: string;

  @Column(DataType.STRING(50))
  declare apellidoPaterno: string;

  @Column(DataType.STRING(50))
  declare apellidoMaterno: string | null;

  @Column(DataType.STRING(60))
  declare nombres: string;

  @Column(DataType.STRING(1))
  declare tipoNomina: string;

  @ForeignKey(() => Adscripcion)
  @Column(DataType.INTEGER)
  declare adscripcionId: number;

  @BelongsTo(() => Adscripcion)
  declare adscripcion: Adscripcion;

  @ForeignKey(() => Puesto)
  @Column(DataType.STRING(12))
  declare puestoClave: string;

  @BelongsTo(() => Puesto)
  declare puesto: Puesto;

  @Column(DataType.SMALLINT)
  declare nivel: number;

  @Column(DataType.SMALLINT)
  declare rango: number;

  @Column(DataType.INTEGER)
  declare numeroIssemym: number | null;

  @Column(DataType.BOOLEAN)
  declare sindicalizado: boolean;

  @Column(DataType.BOOLEAN)
  declare sci: boolean;

  @Column(DataType.STRING(10))
  declare estado: EstadoEmpleado;

  @Column(DataType.DATEONLY)
  declare fechaAlta: string;

  @Column(DataType.DATEONLY)
  declare fechaBaja: string | null;

  @Column(DataType.DATEONLY)
  declare fechaIngresoGobierno: string | null;

  @Column(DataType.DATEONLY)
  declare fechaNacimiento: string | null;

  @Column(DataType.STRING(5))
  declare codigoPostalFiscal: string | null;

  @Column(DataType.STRING(20))
  declare banco: string | null;

  @Column(DataType.STRING(18))
  declare cuentaBancaria: string | null;

  @Column(DataType.BOOLEAN)
  declare pagoCheque: boolean;

  @HasOne(() => DatosPersonales)
  declare datosPersonales: DatosPersonales | null;

  @HasMany(() => EmpleadoConcepto)
  declare conceptosFijos: EmpleadoConcepto[];

  @HasMany(() => DescuentoPlazo)
  declare descuentosPlazo: DescuentoPlazo[];

  @HasMany(() => CuentaContable)
  declare cuentasContables: CuentaContable[];

  @HasOne(() => SucursalBancaria)
  declare sucursal: SucursalBancaria | null;

  /** "PATERNO MATERNO NOMBRES", como lo imprimía el sistema anterior. */
  get nombreCompleto(): string {
    return [this.apellidoPaterno, this.apellidoMaterno, this.nombres].filter(Boolean).join(' ');
  }
}

@Table({ tableName: 'datos_personales', underscored: true, timestamps: true })
export class DatosPersonales extends Model {
  @ForeignKey(() => Empleado)
  @Column({ type: DataType.INTEGER, primaryKey: true })
  declare empleadoId: number;

  @Column(DataType.STRING(1))
  declare sexo: string | null;

  @Column(DataType.STRING(20))
  declare estadoCivil: string | null;

  @Column(DataType.STRING(120))
  declare correo: string | null;

  @Column(DataType.STRING(20))
  declare telefono: string | null;

  @Column(DataType.STRING(150))
  declare domicilio: string | null;

  @Column(DataType.STRING(80))
  declare colonia: string | null;

  @Column(DataType.STRING(5))
  declare codigoPostal: string | null;

  @Column(DataType.STRING(40))
  declare entidad: string | null;

  @Column(DataType.STRING(80))
  declare profesion: string | null;

  @Column(DataType.TEXT)
  declare observaciones: string | null;
}

@Table({ tableName: 'empleado_conceptos', underscored: true, timestamps: true })
export class EmpleadoConcepto extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Empleado)
  @Column(DataType.INTEGER)
  declare empleadoId: number;

  @ForeignKey(() => Concepto)
  @Column(DataType.INTEGER)
  declare conceptoId: number;

  @BelongsTo(() => Concepto)
  declare concepto: Concepto;

  @Column(dinero('importe'))
  declare importe: number;

  /** null = como el ajuste de la quincena o el catálogo. */
  @Column(DataType.BOOLEAN)
  declare gravaIsr: boolean | null;

  @Column(DataType.BOOLEAN)
  declare timbra: boolean | null;
}

@Table({ tableName: 'descuentos_plazo', underscored: true, timestamps: true })
export class DescuentoPlazo extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Empleado)
  @Column(DataType.INTEGER)
  declare empleadoId: number;

  @ForeignKey(() => Concepto)
  @Column(DataType.INTEGER)
  declare conceptoId: number;

  @BelongsTo(() => Concepto)
  declare concepto: Concepto;

  @Column(dinero('importeQuincenal'))
  declare importeQuincenal: number;

  @Column(decimal('porcentaje', 6, 3, true))
  declare porcentaje: number | null;

  @Column(DataType.SMALLINT)
  declare quincenasPendientes: number | null;

  @Column(DataType.STRING(120))
  declare beneficiario: string | null;

  @Column(DataType.BOOLEAN)
  declare activo: boolean;
}

@Table({ tableName: 'cuentas_contables', underscored: true, timestamps: true })
export class CuentaContable extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Empleado)
  @Column(DataType.INTEGER)
  declare empleadoId: number;

  @ForeignKey(() => Concepto)
  @Column(DataType.INTEGER)
  declare conceptoId: number;

  @BelongsTo(() => Concepto)
  declare concepto: Concepto;

  @Column(DataType.STRING(16))
  declare partida: string;
}

@Table({ tableName: 'sucursales_bancarias', underscored: true, timestamps: true })
export class SucursalBancaria extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Empleado)
  @Column(DataType.INTEGER)
  declare empleadoId: number;

  @Column(DataType.SMALLINT)
  declare sucursal: number;

  @Column(DataType.STRING(1))
  declare tipo: string;
}

export type TipoMovimiento = 'alta' | 'baja' | 'permiso' | 'reingreso' | 'cambio';

@Table({ tableName: 'movimientos_personal', underscored: true, timestamps: true })
export class MovimientoPersonal extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @ForeignKey(() => Empleado)
  @Column(DataType.INTEGER)
  declare empleadoId: number;

  @BelongsTo(() => Empleado)
  declare empleado: Empleado;

  @Column(DataType.INTEGER)
  declare periodoId: number | null;

  @Column(DataType.STRING(10))
  declare tipo: TipoMovimiento;

  @ForeignKey(() => Motivo)
  @Column(DataType.STRING(4))
  declare motivoClave: string | null;

  @BelongsTo(() => Motivo)
  declare motivo: Motivo | null;

  @Column(DataType.DATEONLY)
  declare fechaInicio: string;

  @Column(DataType.DATEONLY)
  declare fechaFin: string | null;

  @Column(DataType.JSONB)
  declare detalle: Record<string, unknown> | null;

  @Column(DataType.TEXT)
  declare observaciones: string | null;

  @Column(DataType.BOOLEAN)
  declare cancelado: boolean;

  @Column(DataType.STRING(20))
  declare canceladoPor: string | null;

  @Column(DataType.STRING(20))
  declare registradoPor: string;
}

@Table({ tableName: 'bitacora', underscored: true, timestamps: true, updatedAt: false })
export class Bitacora extends Model {
  @Column({ type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column(DataType.STRING(20))
  declare usuario: string;

  @Column(DataType.STRING(30))
  declare entidad: string;

  @Column(DataType.STRING(40))
  declare entidadId: string | null;

  @Column(DataType.STRING(30))
  declare accion: string;

  @Column(DataType.JSONB)
  declare antes: Record<string, unknown> | null;

  @Column(DataType.JSONB)
  declare despues: Record<string, unknown> | null;

  declare createdAt: Date;
}
