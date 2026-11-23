/**
 * El ISR del Análisis, calculado en el navegador con las mismas reglas y el mismo redondeo que
 * backend/src/motor, y con las tablas de cada quincena: tarifa quincenal, o mensual con ajuste en la
 * 2a quincena. Con las marcas del catálogo la diferencia debe dar 0.
 * El ISR de retroactivos por alta o reingreso (601) no se simula.
 */
import type { DatosAnalisis, MetodoIsr, TipoCalculo } from '../../core/services/modelos';

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
  /** Lo gravado y retenido en la 1a quincena del mes, si el método ajusta. */
  primera: { base: number; isr: number } | null;
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

const APROX = [0, -1, -2, 2, 1, 0, -1, -2, 2, 1];
const aCinco = (c: number) => c + Math.sign(c || 1) * APROX[Math.abs(c) % 10];

/** ISR a retener para una base, según el tipo de pago y el método de la quincena. */
export function isrPara(base: number, tipo: TipoCalculo, m: MetodoIsr, primera: { base: number; isr: number } | null): number {
  if (base <= 0) return 0;
  if (!m.mensual || tipo !== 'nomina') {
    const causado = isrDeTarifa(base, m.tarifa);
    return Math.max(0, causado - (tipo === 'nomina' ? subsidioDe(base, m.subsidio) : 0));
  }
  const p = m.ajuste && primera ? { base: m.redondeo === 5 ? aCinco(primera.base) : primera.base, isr: primera.isr } : null;
  const baseTarifa = p ? p.base + base : base * 2;
  const fila = [...m.tarifa].reverse().find((f) => centavos(f[0]) < baseTarifa);
  const bruto = fila ? centavos(fila[1]) * 1e6 + (baseTarifa - centavos(fila[0])) * Math.round(fila[2] * 1e4) : 0;
  const isr = Math.round((bruto - subsidioDe(baseTarifa, m.subsidio) * 1e6) / ((p ? 1 : 2) * 1e6) - (p?.isr ?? 0));
  return Math.max(m.redondeo === 5 ? aCinco(isr) : isr, centavos(m.minimo));
}

/** Recalcula todos los recibos con las marcas de "Grava ISR" que se le den. */
export function calcularRecibos(datos: DatosAnalisis, grava: Map<number, boolean>): ReciboCalculado[] {
  const conceptos = new Map(datos.conceptos.map((c) => [c.id, c]));
  const exentoAguinaldo = centavos(datos.parametros.umaDiaria * 30);
  const exentoPrima = centavos(datos.parametros.umaDiaria * 15);

  const porRecibo: [number, number][][] = datos.recibos.map(() => []);
  for (const [r, concepto, importe] of datos.lineas) porRecibo[r]?.push([concepto, importe]);

  const lista = datos.recibos.map((recibo, indice): ReciboCalculado => {
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
      isrCalculado: 0,
      primera: null,
      gravadoPorConcepto,
    };
  });

  // La 2a quincena necesita lo de la 1a del mismo mes; por eso el ISR se calcula al final.
  const llave = (empleado: number, quincena: number) => `${empleado}|${quincena}`;
  const primeras = new Map<string, ReciboCalculado>();
  for (const r of lista) {
    const p = datos.periodos[r.periodo];
    if (p?.tipo === 'nomina' && p.quincena % 2 === 1) primeras.set(llave(r.empleado, p.quincena), r);
  }
  for (const r of lista) {
    const p = datos.periodos[r.periodo];
    const primera = p?.tipo === 'nomina' && p.quincena % 2 === 0 ? primeras.get(llave(r.empleado, p.quincena - 1)) : undefined;
    r.primera = primera ? { base: primera.gravado, isr: primera.isrRetenido } : null;
    r.isrCalculado = isrPara(r.gravado, r.tipo, datos.metodos[p?.metodo ?? 0], r.primera);
  }
  return lista;
}

/**
 * Cuánto subir el bruto gravable de un recibo para que, reteniendo el ISR con las marcas actuales,
 * la persona reciba el mismo neto que hoy (percepciones − ISR retenido). Resuelve
 * X = ISR(gravado + X) − ISR retenido por aproximaciones; converge porque la tasa marginal es < 1.
 */
export function incrementoNecesario(r: ReciboCalculado, datos: DatosAnalisis): number {
  if (r.isrCalculado <= r.isrRetenido) return 0;
  const metodo = datos.metodos[datos.periodos[r.periodo]?.metodo ?? 0];
  let x = r.isrCalculado - r.isrRetenido;
  for (let i = 0; i < 30; i++) {
    const siguiente = isrPara(r.gravado + x, r.tipo, metodo, r.primera) - r.isrRetenido;
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
