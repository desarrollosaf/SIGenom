import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { decimal, dinero } from './columnas';

@Table({ tableName: 'tipos_nomina', underscored: true, timestamps: false })
export class TipoNomina extends Model {
  @Column({ type: DataType.STRING(1), primaryKey: true })
  declare clave: string;

  @Column(DataType.STRING(40))
  declare nombre: string;

  @Column(DataType.SMALLINT)
  declare orden: number;

  @Column(DataType.BOOLEAN)
  declare activo: boolean;
}

@Table({ tableName: 'adscripciones', underscored: true, timestamps: true })
export class Adscripcion extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true })
  declare id: number;

  @Column(DataType.STRING(120))
  declare descripcion: string;

  @Column(DataType.STRING(20))
  declare areaPresupuestal: string | null;

  @Column(DataType.BOOLEAN)
  declare activo: boolean;
}

@Table({ tableName: 'puestos', underscored: true, timestamps: true })
export class Puesto extends Model {
  @Column({ type: DataType.STRING(12), primaryKey: true })
  declare clave: string;

  @Column(DataType.STRING(120))
  declare descripcion: string;

  @Column(DataType.BOOLEAN)
  declare activo: boolean;
}

/**
 * Tabulador por nivel y rango (tabla-rang). Cambia con cada aumento: cada renglón vale desde su
 * vigencia y la quincena usa el más reciente que no sea posterior a su fecha.
 * Importes mensuales: la quincena paga la mitad (sueldo 001, gratificación 012, compensación 011).
 */
@Table({ tableName: 'tabulador', underscored: true, timestamps: true })
export class Tabulador extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column(DataType.DATEONLY)
  declare vigencia: string;

  @Column(DataType.SMALLINT)
  declare nivel: number;

  @Column(DataType.SMALLINT)
  declare rango: number;

  @Column(dinero('sueldoMensual'))
  declare sueldoMensual: number;

  @Column(dinero('compensacionMensual'))
  declare compensacionMensual: number;

  @Column(dinero('gratificacionMensual'))
  declare gratificacionMensual: number;
}

@Table({ tableName: 'conceptos', underscored: true, timestamps: true })
export class Concepto extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column(DataType.STRING(1))
  declare tipoNomina: string;

  @Column(DataType.SMALLINT)
  declare clave: number;

  @Column(DataType.STRING(12))
  declare abreviatura: string;

  @Column(DataType.STRING(60))
  declare descripcion: string;

  @Column(DataType.STRING(1))
  declare naturaleza: 'P' | 'D';

  @Column(DataType.STRING(1))
  declare periodicidad: 'F' | 'E';

  @Column(DataType.BOOLEAN)
  declare gravaIsr: boolean;

  @Column(decimal('factorIssemym', 5, 3))
  declare factorIssemym: number;

  @Column(DataType.STRING(16))
  declare partida: string | null;

  @Column(DataType.SMALLINT)
  declare claveIssemym: number | null;

  @Column(DataType.STRING(20))
  declare calculado: string | null;

  /** Va en el CFDI de nómina. Una quincena puede cambiarlo con un ajuste (PeriodoConcepto). */
  @Column(DataType.BOOLEAN)
  declare timbra: boolean;

  @Column(DataType.BOOLEAN)
  declare activo: boolean;
}

@Table({ tableName: 'tabla_isr', underscored: true, timestamps: true })
export class TablaIsr extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  /** M mensual, Q quincenal. */
  @Column(DataType.STRING(1))
  declare periodicidad: 'M' | 'Q';

  @Column(DataType.DATEONLY)
  declare vigencia: string;

  @Column(dinero('limiteInferior'))
  declare limiteInferior: number;

  @Column(dinero('cuotaFija'))
  declare cuotaFija: number;

  @Column(decimal('porcentaje', 6, 4))
  declare porcentaje: number;
}

@Table({ tableName: 'tabla_subsidio', underscored: true, timestamps: true })
export class TablaSubsidio extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  /** M mensual, Q quincenal. */
  @Column(DataType.STRING(1))
  declare periodicidad: 'M' | 'Q';

  @Column(DataType.DATEONLY)
  declare vigencia: string;

  @Column(dinero('ingresoDesde'))
  declare ingresoDesde: number;

  @Column(dinero('subsidio'))
  declare subsidio: number;
}

@Table({ tableName: 'motivos', underscored: true, timestamps: true })
export class Motivo extends Model {
  @Column({ type: DataType.STRING(4), primaryKey: true })
  declare clave: string;

  @Column(DataType.STRING(80))
  declare descripcion: string;

  @Column(DataType.STRING(1))
  declare aplica: 'B' | 'P';

  @Column(DataType.BOOLEAN)
  declare activo: boolean;
}

@Table({ tableName: 'parametros', underscored: true, timestamps: true })
export class Parametro extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column(DataType.STRING(40))
  declare clave: string;

  /** Desde cuándo vale. Las quincenas usan el valor más reciente vigente a su fecha. */
  @Column(DataType.DATEONLY)
  declare vigencia: string;

  @Column(DataType.STRING(200))
  declare valor: string;

  @Column(DataType.STRING(200))
  declare descripcion: string;
}
