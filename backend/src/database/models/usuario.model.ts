import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'usuarios', underscored: true, timestamps: true })
export class Usuario extends Model {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column({ type: DataType.STRING(20), allowNull: false, unique: true })
  declare usuario: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare nombre: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare passwordHash: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare rol: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare activo: boolean;

  @Column(DataType.DATE)
  declare ultimoAcceso: Date | null;
}
