import { Column, DataType, Model, Table } from 'sequelize-typescript';

export type Sistema = 'personal' | 'checador' | 'prestamos';
export type EstadoExterno = 'pendiente' | 'aplicando' | 'aplicado' | 'descartado';

/** Un movimiento que mandó otro sistema, tal como llegó, y qué se hizo con él. */
@Table({ tableName: 'movimientos_externos', underscored: true, timestamps: true })
export class MovimientoExterno extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column(DataType.STRING(12))
  declare sistema: Sistema;

  @Column(DataType.STRING(40))
  declare externoId: string;

  @Column(DataType.STRING(20))
  declare lote: string | null;

  @Column(DataType.STRING(20))
  declare tipo: string;

  @Column(DataType.STRING(10))
  declare subtipo: string | null;

  @Column(DataType.STRING(18))
  declare curp: string | null;

  @Column(DataType.STRING(13))
  declare rfc: string | null;

  @Column(DataType.STRING(170))
  declare nombre: string;

  @Column(DataType.STRING(1))
  declare tipoNomina: string | null;

  @Column(DataType.SMALLINT)
  declare anio: number | null;

  @Column(DataType.SMALLINT)
  declare quincena: number | null;

  @Column(DataType.DATEONLY)
  declare fecha: string | null;

  @Column(DataType.JSONB)
  declare datos: Record<string, unknown>;

  @Column(DataType.STRING(12))
  declare estado: EstadoExterno;

  @Column(DataType.TEXT)
  declare mensaje: string | null;

  @Column(DataType.INTEGER)
  declare empleadoId: number | null;

  @Column(DataType.STRING(20))
  declare atendidoPor: string | null;

  @Column(DataType.DATE)
  declare atendidoEl: Date | null;

  declare createdAt: Date;
}

@Table({ tableName: 'lecturas_externas', underscored: true, timestamps: true })
export class LecturaExterna extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column(DataType.STRING(12))
  declare sistema: Sistema;

  @Column(DataType.STRING(20))
  declare usuario: string;

  @Column(DataType.INTEGER)
  declare nuevos: number;

  @Column(DataType.TEXT)
  declare error: string | null;

  declare createdAt: Date;
}
