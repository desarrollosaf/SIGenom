import { aCentavos, porTasa } from './centavos';
import type { FilaIsr, FilaSubsidio } from './tipos';

/**
 * ISR del periodo con la tarifa del artículo 96 (la tabla de Cata-ispt). Busca el último renglón
 * cuyo límite inferior no rebasa la base, igual que el `FIND LAST cata-ispt` de 1cal-isp.p.
 * Recibe y devuelve centavos.
 */
export function isrDeTarifa(baseCentavos: number, tarifa: FilaIsr[]): number {
  if (baseCentavos <= 0 || tarifa.length === 0) return 0;
  let fila: FilaIsr | undefined;
  for (const renglon of tarifa) {
    if (aCentavos(renglon.limiteInferior) <= baseCentavos) fila = renglon;
    else break;
  }
  if (!fila) return 0;
  const excedente = baseCentavos - aCentavos(fila.limiteInferior);
  return aCentavos(fila.cuotaFija) + porTasa(excedente, fila.porcentaje / 100);
}

/** Subsidio para el empleo (antes "crédito al salario", Tab-cre) que corresponde a la base. */
export function subsidioDeTabla(baseCentavos: number, tabla: FilaSubsidio[]): number {
  if (baseCentavos <= 0) return 0;
  let subsidio = 0;
  for (const renglon of tabla) {
    if (aCentavos(renglon.ingresoDesde) <= baseCentavos) subsidio = aCentavos(renglon.subsidio);
    else break;
  }
  return subsidio;
}

/** Las tablas se recorren en orden; se ordenan una vez al cargarlas. */
export const ordenarTarifa = (filas: FilaIsr[]) =>
  [...filas].sort((a, b) => a.limiteInferior - b.limiteInferior);
export const ordenarSubsidio = (filas: FilaSubsidio[]) =>
  [...filas].sort((a, b) => a.ingresoDesde - b.ingresoDesde);
