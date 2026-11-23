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

/** Último dígito de los centavos -> ajuste a múltiplo de 5 (arreglo `aprox` de 1CAL-N-P.W). */
const APROX = [0, -1, -2, 2, 1, 0, -1, -2, 2, 1];
export const aCincoCentavos = (centavos: number) => centavos + Math.sign(centavos || 1) * APROX[Math.abs(centavos) % 10];

/**
 * ISR con la tarifa mensual, como 1CAL-P-I.P y 1CAL-ISP.P:
 *  - 1a quincena (o sin ajuste): tarifa sobre el doble de la base, menos subsidio, entre dos.
 *  - 2a quincena con ajuste: tarifa sobre lo gravado en el mes, menos subsidio, menos lo retenido en la 1a.
 * El límite inferior es estricto (`i_ispt > lim-inf`) y no se redondea hasta el final.
 */
export function isrMensual(
  baseCentavos: number,
  tarifa: FilaIsr[],
  subsidios: FilaSubsidio[],
  opciones: { redondeo: number; minimo: number; primera: { base: number; isr: number } | null },
) {
  if (baseCentavos <= 0) return { isr: 0, causado: 0, subsidio: 0, baseTarifa: 0 };
  const { primera } = opciones;
  const redondear = (c: number) => (opciones.redondeo === 5 ? aCincoCentavos(Math.round(c)) : Math.round(c));
  const baseTarifa = primera ? primera.base + baseCentavos : baseCentavos * 2;
  const fila = [...tarifa].reverse().find((f) => aCentavos(f.limiteInferior) < baseTarifa);
  // En millonésimas de centavo, para no arrastrar redondeos antes de dividir.
  const bruto = fila
    ? aCentavos(fila.cuotaFija) * 1e6 + (baseTarifa - aCentavos(fila.limiteInferior)) * Math.round(fila.porcentaje * 1e4)
    : 0;
  const subsidioMes = subsidioDeTabla(baseTarifa, subsidios);
  const partes = primera ? 1 : 2;
  const neto = redondear((bruto - subsidioMes * 1e6) / (partes * 1e6) - (primera?.isr ?? 0));
  return {
    isr: Math.max(neto, opciones.minimo),
    causado: Math.round(bruto / (partes * 1e6)),
    subsidio: Math.round(subsidioMes / partes),
    baseTarifa,
  };
}

/** Las tablas se recorren en orden; se ordenan una vez al cargarlas. */
export const ordenarTarifa = (filas: FilaIsr[]) =>
  [...filas].sort((a, b) => a.limiteInferior - b.limiteInferior);
export const ordenarSubsidio = (filas: FilaSubsidio[]) =>
  [...filas].sort((a, b) => a.ingresoDesde - b.ingresoDesde);
