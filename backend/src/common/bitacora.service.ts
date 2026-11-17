import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Bitacora } from '../database/models/personal.models';

/** Quién cambió qué y cuándo: sustituye a H-mov y H-perded del sistema anterior. */
@Injectable()
export class BitacoraService {
  constructor(@InjectModel(Bitacora) private readonly bitacora: typeof Bitacora) {}

  async registrar(
    datos: {
      usuario: string;
      entidad: string;
      entidadId?: string | number | null;
      accion: string;
      antes?: object | null;
      despues?: object | null;
    },
    transaction?: Transaction,
  ): Promise<void> {
    await this.bitacora.create(
      {
        ...datos,
        entidadId: datos.entidadId === undefined || datos.entidadId === null ? null : String(datos.entidadId),
        antes: datos.antes ?? null,
        despues: datos.despues ?? null,
      },
      { transaction },
    );
  }

  /** Solo los campos que cambiaron, para que la bitácora se lea fácil. */
  static diferencias(antes: Record<string, unknown>, despues: Record<string, unknown>) {
    const a: Record<string, unknown> = {};
    const d: Record<string, unknown> = {};
    for (const campo of Object.keys(despues)) {
      if (String(antes[campo] ?? '') !== String(despues[campo] ?? '')) {
        a[campo] = antes[campo] ?? null;
        d[campo] = despues[campo] ?? null;
      }
    }
    return Object.keys(d).length ? { antes: a, despues: d } : null;
  }
}
