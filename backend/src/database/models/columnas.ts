import { DataType } from 'sequelize-typescript';
import type { ModelAttributeColumnOptions } from 'sequelize';

/**
 * PostgreSQL entrega NUMERIC como texto para no perder precisión. Aquí se lee como número: los
 * importes de nómina caben de sobra en un double con dos decimales, y el motor trabaja en centavos.
 */
export const dinero = (campo: string, extra: Partial<ModelAttributeColumnOptions> = {}) => ({
  type: DataType.DECIMAL(14, 2),
  allowNull: false,
  defaultValue: 0,
  get(this: { getDataValue: (c: string) => unknown }) {
    const valor = this.getDataValue(campo);
    return valor === null || valor === undefined ? null : Number(valor);
  },
  ...extra,
});

/** Igual que `dinero`, para tasas y factores. */
export const decimal = (campo: string, precision: number, escala: number, allowNull = false) => ({
  type: DataType.DECIMAL(precision, escala),
  allowNull,
  get(this: { getDataValue: (c: string) => unknown }) {
    const valor = this.getDataValue(campo);
    return valor === null || valor === undefined ? null : Number(valor);
  },
});
