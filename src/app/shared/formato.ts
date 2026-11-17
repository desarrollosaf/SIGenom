import { Pipe, PipeTransform } from '@angular/core';

const MONEDA = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const NUMERO = new Intl.NumberFormat('es-MX');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** $12,345.67 */
@Pipe({ name: 'moneda' })
export class MonedaPipe implements PipeTransform {
  transform(valor: number | null | undefined): string {
    return valor === null || valor === undefined ? '—' : MONEDA.format(valor);
  }
}

/** 12,345 */
@Pipe({ name: 'numero' })
export class NumeroPipe implements PipeTransform {
  transform(valor: number | null | undefined): string {
    return valor === null || valor === undefined ? '—' : NUMERO.format(valor);
  }
}

/** "2026-11-15" -> "15 nov 2026". Las fechas sin hora no pasan por Date para no correrse de día. */
@Pipe({ name: 'fecha' })
export class FechaPipe implements PipeTransform {
  transform(valor: string | null | undefined, conHora = false): string {
    if (!valor) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      const [a, m, d] = valor.split('-');
      return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
    }
    const fecha = new Date(valor);
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(conHora ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
    })
      .format(fecha)
      .replace('.', '');
  }
}

export const FORMATO = [MonedaPipe, NumeroPipe, FechaPipe];
