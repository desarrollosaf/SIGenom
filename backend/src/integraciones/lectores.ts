import type { Sistema } from '../database/models/externos.models';

/** Un movimiento ya con la forma de SIGenom; `datos` guarda el renglón original completo. */
export interface MovimientoLeido {
  externoId: string;
  lote: string | null;
  tipo: string;
  subtipo: string | null;
  curp: string | null;
  rfc: string | null;
  nombre: string;
  tipoNomina: string | null;
  anio: number | null;
  quincena: number | null;
  fecha: string | null;
  datos: Record<string, unknown>;
}

export type Renglon = Record<string, unknown>;

export interface Lector {
  clave: Sistema;
  nombre: string;
  descripcion: string;
  /** Nombres de los tipos, en el orden en que se muestran. */
  tipos: Record<string, string>;
  /** Solo SELECT. Recibe :desde, el último id que ya se trajo. */
  sql: string;
  leer: (r: Renglon) => MovimientoLeido;
}

const texto = (v: unknown, max = 250): string | null => {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
};
const entero = (v: unknown): number | null => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isInteger(n) ? null : n;
};
/** Fecha sin hora; PostgreSQL la entrega como texto o como Date según la columna. */
const fecha = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = /^\d{4}-\d{2}-\d{2}/.exec(texto(v) ?? '');
  return m ? m[0] : null;
};
const rfc = (v: unknown) => texto(v)?.replace(/[^A-Za-z0-9Ññ&]/g, '').toUpperCase().slice(0, 13) ?? null;
const objeto = (v: unknown): Renglon => {
  if (typeof v === 'string') {
    try {
      const o: unknown = JSON.parse(v);
      return o && typeof o === 'object' ? (o as Renglon) : {};
    } catch {
      return {};
    }
  }
  return v && typeof v === 'object' ? (v as Renglon) : {};
};

/** SIModpersonal: lo que se transfirió a nómina, por lote. No se vuelve a editar allá. */
const PERSONAL: Lector = {
  clave: 'personal',
  nombre: 'Personal',
  descripcion: 'Altas, bajas, promociones, transferencias y licencias',
  tipos: { A: 'Alta', B: 'Baja', P: 'Promoción', T: 'Transferencia', L: 'Licencia' },
  sql: `SELECT id, tipo_mov, folio, lote_id, anio, no_qna, rfc, curp, nombre, subtipo, fecha_baja::text fecha_baja,
               fecha_mov::text fecha_mov, observaciones, datos
        FROM movimientos_historico WHERE id > :desde ORDER BY id LIMIT 5000`,
  leer: (r) => {
    const d = objeto(r.datos);
    const base = rfc(r.rfc) ?? '';
    const homoclave = texto(d.homoclave, 3) ?? '';
    return {
      externoId: String(r.id),
      lote: texto(r.lote_id, 20),
      tipo: texto(r.tipo_mov, 1) ?? '?',
      subtipo: texto(r.subtipo, 10)?.toUpperCase() ?? null,
      curp: texto(r.curp, 18)?.toUpperCase() ?? null,
      rfc: (base.length === 10 ? base + homoclave : base) || null,
      nombre: texto(r.nombre, 170) ?? 'Sin nombre',
      tipoNomina: texto(d.tipoNomina, 1)?.toUpperCase() ?? null,
      anio: entero(r.anio),
      quincena: entero(r.no_qna),
      fecha: fecha(r.tipo_mov === 'B' ? (r.fecha_baja ?? r.fecha_mov) : (d.fAlta && r.tipo_mov === 'A' ? d.fAlta : r.fecha_mov)),
      datos: { ...d, folio: r.folio, observaciones: r.observaciones ?? d.obs ?? null },
    };
  },
};

/** Incidencias ya convertidas a importe por el sistema de checadores (docs/integraciones.md). */
const CHECADOR: Lector = {
  clave: 'checador',
  nombre: 'Checadores',
  descripcion: 'Descuentos por faltas, reintegros y estímulos',
  tipos: { falta: 'Falta', retardo: 'Retardo', reintegro: 'Reintegro', estimulo: 'Estímulo', otro: 'Otro' },
  sql: `SELECT id, curp, rfc, nombre, tipo_nomina, tipo, clave, importe, dias, fecha::text fecha, anio, quincena, referencia
        FROM control_incidencias WHERE id > :desde ORDER BY id LIMIT 5000`,
  leer: (r) => ({
    externoId: String(r.id),
    lote: null,
    tipo: (texto(r.tipo, 20) ?? 'otro').toLowerCase(),
    subtipo: null,
    curp: texto(r.curp, 18)?.toUpperCase() ?? null,
    rfc: rfc(r.rfc),
    nombre: texto(r.nombre, 170) ?? texto(r.curp) ?? 'Sin nombre',
    tipoNomina: texto(r.tipo_nomina, 1)?.toUpperCase() ?? null,
    anio: entero(r.anio),
    quincena: entero(r.quincena),
    fecha: fecha(r.fecha),
    datos: { clave: r.clave, importe: r.importe, dias: r.dias, referencia: r.referencia },
  }),
};

/** Movimientos de préstamos; `prestamo` identifica el mismo préstamo en su alta, cambio y liquidación. */
const PRESTAMOS: Lector = {
  clave: 'prestamos',
  nombre: 'Préstamos',
  descripcion: 'Préstamos nuevos, cambios, suspensiones y liquidaciones',
  tipos: { alta: 'Nuevo', cambio: 'Cambio', suspension: 'Suspensión', reanudacion: 'Reanudación', liquidacion: 'Liquidación' },
  sql: `SELECT id, prestamo, curp, rfc, nombre, tipo_nomina, tipo, clave, importe_quincenal, quincenas, importe, beneficiario,
               fecha::text fecha, anio, quincena, referencia
        FROM control_prestamos WHERE id > :desde ORDER BY id LIMIT 5000`,
  leer: (r) => ({
    externoId: String(r.id),
    lote: texto(r.prestamo, 20),
    tipo: (texto(r.tipo, 20) ?? '?').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
    subtipo: null,
    curp: texto(r.curp, 18)?.toUpperCase() ?? null,
    rfc: rfc(r.rfc),
    nombre: texto(r.nombre, 170) ?? texto(r.curp) ?? 'Sin nombre',
    tipoNomina: texto(r.tipo_nomina, 1)?.toUpperCase() ?? null,
    anio: entero(r.anio),
    quincena: entero(r.quincena),
    fecha: fecha(r.fecha),
    datos: {
      prestamo: r.prestamo, clave: r.clave, importeQuincenal: r.importe_quincenal, quincenas: r.quincenas,
      importe: r.importe, beneficiario: r.beneficiario, referencia: r.referencia,
    },
  }),
};

export const LECTORES: Lector[] = [PERSONAL, CHECADOR, PRESTAMOS];
