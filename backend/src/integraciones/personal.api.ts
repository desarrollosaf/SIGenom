import { createHash } from 'node:crypto';
import type { Renglon } from './lectores';

/** Lo más que entrega SIModpersonal en una consulta. */
export const LIMITE_PERSONAL = 1000;

export interface ConfirmacionPersonal {
  confirmados: string[];
  yaEnviados: string[];
  noEncontrados: string[];
  /** Al confirmar, SIModpersonal registra altas y transferencias en SAF; aquí dice cuáles no pudo. */
  errores: { folio: string; mensaje: string }[];
}

/** Lo que no cambia el movimiento (avisos, fechas de control): no cuenta para saber si lo corrigieron. */
const CONTROL = new Set(['estatusMotivo', 'updatedAt', 'actualizadoPor', 'safUsuarioId', 'safSincronizadoAt', 'safError', 'enviadoAt', 'validadoPor', 'validadoAt']);

/** Cambia solo si cambió el contenido del movimiento. */
export function huella(r: Renglon): string {
  const campos = Object.keys(r).filter((k) => !CONTROL.has(k)).sort();
  return createHash('sha256').update(JSON.stringify(campos.map((k) => [k, r[k]]))).digest('hex').slice(0, 24);
}

/**
 * API de SIModpersonal para nómina (/nomina/movimientos, con llave x-api-key): entrega los movimientos
 * pendientes, y nómina le avisa cuáles tomó o cuáles rechaza.
 */
export class PersonalApi {
  private constructor(private readonly base: string, private readonly llave: string) {}

  /** EXT_PERSONAL_URL y EXT_PERSONAL_LLAVE; sin alguna, no está conectado. */
  static configurada(): PersonalApi | null {
    const base = process.env.EXT_PERSONAL_URL?.trim().replace(/\/+$/, '');
    const llave = process.env.EXT_PERSONAL_LLAVE?.trim();
    return base && llave ? new PersonalApi(base, llave) : null;
  }

  async pendientes(): Promise<Renglon[]> {
    const r = await this.pedir('GET', `?limite=${LIMITE_PERSONAL}`);
    if (!Array.isArray(r)) throw new Error('Respuesta inesperada de SIModpersonal');
    return r as Renglon[];
  }

  async confirmar(folios: string[]): Promise<ConfirmacionPersonal> {
    const r = (await this.pedir('POST', '/confirmar', { folios })) as Partial<ConfirmacionPersonal> & { saf?: { errores?: ConfirmacionPersonal['errores'] } };
    return { confirmados: r.confirmados ?? [], yaEnviados: r.yaEnviados ?? [], noEncontrados: r.noEncontrados ?? [], errores: (r.saf?.errores ?? []).filter((e) => folios.includes(e.folio)) };
  }

  async rechazar(folio: string, motivo: string): Promise<void> {
    await this.pedir('POST', '/rechazar', { folio, motivo });
  }

  private async pedir(metodo: string, ruta: string, cuerpo?: unknown): Promise<unknown> {
    const r = await fetch(`${this.base}/nomina/movimientos${ruta}`, {
      method: metodo,
      headers: { 'x-api-key': this.llave, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(60_000),
      // Una redirección podría llevar la llave a otro servidor.
      redirect: 'error',
    });
    const texto = await r.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      /* no era JSON */
    }
    if (!r.ok) {
      const m = json && typeof json === 'object' && 'message' in json ? (json as { message: unknown }).message : '';
      throw new Error(`HTTP ${r.status} ${Array.isArray(m) ? m.join(' ') : String(m ?? '')}`.trim());
    }
    return json;
  }
}
