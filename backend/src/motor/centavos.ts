/**
 * Toda la aritmética del motor va en centavos enteros: sumar 0.1 + 0.2 en double da
 * 0.30000000000000004, y en una nómina de miles de recibos esos residuos sí se notan.
 */
export const aCentavos = (pesos: number): number => Math.round(pesos * 100);
export const aPesos = (centavos: number): number => centavos / 100;

/** Multiplica centavos por una tasa y redondea al centavo (mitad hacia arriba). */
export const porTasa = (centavos: number, tasa: number): number => Math.round(centavos * tasa);
