/**
 * El ISR del Análisis, calculado en el navegador con las mismas reglas y el mismo redondeo que
 * backend/src/motor: centavos enteros, tarifa por "último renglón que no pasa la base", subsidio solo
 * en nómina quincenal y sin bajar de cero. Con las marcas del catálogo la diferencia debe dar 0.
 */
import type { DatosAnalisis, TipoCalculo } from '../../core/services/modelos';

export interface ReciboCalculado {
  indice: number;
  empleado: number;
  periodo: number;
  tipo: TipoCalculo;
  percepciones: number;
  deducciones: number;
  gravado: number;
  isrRetenido: number;
  isrCalculado: number;
  /** Lo que se grava de cada clave en este recibo (para repartir el ISR). */
  gravadoPorConcepto: Map<number, number>;
}

const centavos = (pesos: number) => Math.round(pesos * 100);

export function isrDeTarifa(base: number, tarifa: DatosAnalisis['tarifa']): number {
  if (base <= 0) return 0;
  let fila: [number, number, number] | undefined;
  for (const r of tarifa) {
    if (centavos(r[0]) <= base) fila = r;
    else break;
  }
  if (!fila) return 0;
  return centavos(fila[1]) + Math.round((base - centavos(fila[0])) * (fila[2] / 100));
}

export function subsidioDe(base: number, tabla: DatosAnalisis['subsidio']): number {
  if (base <= 0) return 0;
  let s = 0;
  for (const r of tabla) {
    if (centavos(r[0]) <= base) s = centavos(r[1]);
    else break;
  }
  return s;
}

/** ISR a retener para una base, según el tipo de pago. */
export function isrPara(base: number, tipo: TipoCalculo, datos: DatosAnalisis): number {
  const causado = isrDeTarifa(base, datos.tarifa);
  const subsidio = tipo === 'nomina' ? subsidioDe(base, datos.subsidio) : 0;
  return Math.max(0, causado - subsidio);
}

/** Recalcula todos los recibos con las marcas de "Grava ISR" que se le den. */
export function calcularRecibos(datos: DatosAnalisis, grava: Map<number, boolean>): ReciboCalculado[] {
  const conceptos = new Map(datos.conceptos.map((c) => [c.id, c]));
  const exentoAguinaldo = centavos(datos.parametros.umaDiaria * 30);
  const exentoPrima = centavos(datos.parametros.umaDiaria * 15);

  const porRecibo: [number, number][][] = datos.recibos.map(() => []);
  for (const [r, concepto, importe] of datos.lineas) porRecibo[r]?.push([concepto, importe]);

  return datos.recibos.map((recibo, indice) => {
    const tipo = datos.periodos[recibo.p]?.tipo ?? 'nomina';
    let percepciones = 0;
    let deducciones = 0;
    let gravado = 0;
    let isrRetenido = 0;
    const gravadoPorConcepto = new Map<number, number>();
    for (const [id, importe] of porRecibo[indice]) {
      const c = conceptos.get(id);
      if (!c) continue;
      if (c.naturaleza === 'D') {
        deducciones += importe;
        if (c.calculado === 'isr') isrRetenido += importe;
        continue;
      }
      percepciones += importe;
      if (!grava.get(id)) continue;
      // Aguinaldo y prima vacacional solo gravan lo que pasa de su parte exenta en UMA.
      const exento = c.calculado === 'aguinaldo' ? exentoAguinaldo : c.calculado === 'prima_vacacional' ? exentoPrima : 0;
      const g = Math.max(0, importe - exento);
      gravado += g;
      gravadoPorConcepto.set(id, (gravadoPorConcepto.get(id) ?? 0) + g);
    }
    return {
      indice,
      empleado: recibo.e,
      periodo: recibo.p,
      tipo,
      percepciones,
      deducciones,
      gravado,
      isrRetenido,
      isrCalculado: isrPara(gravado, tipo, datos),
      gravadoPorConcepto,
    };
  });
}

/**
 * Cuánto subir el bruto gravable de un recibo para que, reteniendo el ISR con las marcas actuales,
 * la persona reciba el mismo neto que hoy (percepciones − ISR retenido). Resuelve
 * X = ISR(gravado + X) − ISR retenido por aproximaciones; converge porque la tasa marginal es < 1.
 */
export function incrementoNecesario(r: ReciboCalculado, datos: DatosAnalisis): number {
  if (r.isrCalculado <= r.isrRetenido) return 0;
  let x = r.isrCalculado - r.isrRetenido;
  for (let i = 0; i < 30; i++) {
    const siguiente = isrPara(r.gravado + x, r.tipo, datos) - r.isrRetenido;
    if (Math.abs(siguiente - x) < 1) return Math.max(0, siguiente);
    x = siguiente;
  }
  return Math.max(0, x);
}

/** Descarga una tabla como CSV que Excel abre con acentos (BOM UTF-8). */
export function descargarCsv(nombre: string, encabezados: string[], filas: (string | number)[][]): void {
  const celda = (v: string | number) => (typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`);
  const texto = '﻿' + [encabezados.map(celda).join(','), ...filas.map((f) => f.map(celda).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
