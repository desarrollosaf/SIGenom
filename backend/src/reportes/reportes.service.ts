import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import type { TablaReporte } from '../common/excel';
import { MESES, nombreQuincena } from '../common/fechas';
import { REPORTES } from './definiciones';

export interface FiltrosReporte {
  calculoId?: number;
  tipoNomina?: string;
  anio?: number;
  mes?: number;
  orden?: string;
}

@Injectable()
export class ReportesService {
  constructor(@InjectConnection() private readonly db: Sequelize) {}

  catalogo() {
    return REPORTES.map(({ sql: _sql, ...def }) => def);
  }

  async ejecutar(clave: string, filtros: FiltrosReporte): Promise<TablaReporte> {
    const def = REPORTES.find((r) => r.clave === clave);
    if (!def) throw new NotFoundException('Ese reporte no existe');

    let subtitulo = '';
    let calculos: number[] = [];
    if (def.filtro === 'calculo') {
      if (!filtros.calculoId) throw new BadRequestException('Elige la quincena y el cálculo.');
      subtitulo = await this.describirCalculo(filtros.calculoId);
    } else {
      if (!filtros.tipoNomina) throw new BadRequestException('Elige el tipo de nómina.');
      if (def.filtro !== 'nomina') {
        if (!filtros.anio) throw new BadRequestException('Elige el año.');
        if (def.filtro === 'mes' && !filtros.mes) throw new BadRequestException('Elige el mes.');
        subtitulo = def.filtro === 'mes' ? `${MESES[filtros.mes! - 1]} ${filtros.anio}` : `Año ${filtros.anio}`;
        if (def.sql.includes(':calculos')) {
          calculos = await this.calculosDe(filtros.tipoNomina, filtros.anio, def.filtro === 'mes' ? filtros.mes : undefined);
        }
      }
    }

    const filas =
      def.sql.includes(':calculos') && calculos.length === 0
        ? []
        : await this.db.query<Record<string, unknown>>(def.sql, {
            replacements: {
              calculo: filtros.calculoId ?? null,
              calculos: calculos.length ? calculos : [0],
              tipo: filtros.tipoNomina ?? null,
              anio: filtros.anio ?? null,
              mes: filtros.mes ?? null,
              orden: filtros.orden ?? def.ordenes?.[0]?.valor ?? '',
            },
            type: QueryTypes.SELECT,
          });

    const totales = def.totales
      ? Object.fromEntries(def.totales.map((c) => [c, Math.round(filas.reduce((s, f) => s + Number(f[c] ?? 0), 0) * 100) / 100]))
      : undefined;
    return { titulo: def.titulo, subtitulo, columnas: def.columnas, filas, totales };
  }

  /** Nóminas terminadas (y aguinaldo o prima, que también pagan) de un año o un mes. */
  private async calculosDe(tipoNomina: string, anio: number, mes?: number) {
    const filas = await this.db.query<{ id: number }>(
      `SELECT DISTINCT ON (c.periodo_id, c.tipo) c.id
       FROM calculos c JOIN periodos p ON p.id = c.periodo_id
       WHERE p.tipo_nomina = :tipo AND p.anio = :anio AND c.estado = 'terminado'
         AND c.tipo IN ('nomina', 'aguinaldo', 'prima_vacacional')
         ${mes ? 'AND ceil(p.quincena / 2.0) = :mes' : ''}
       ORDER BY c.periodo_id, c.tipo, c.id DESC`,
      { replacements: { tipo: tipoNomina, anio, mes: mes ?? null }, type: QueryTypes.SELECT },
    );
    return filas.map((f) => f.id);
  }

  private async describirCalculo(calculoId: number) {
    const [fila] = await this.db.query<{ anio: number; quincena: number; tipo: string; nomina: string }>(
      `SELECT p.anio, p.quincena, c.tipo, t.nombre nomina FROM calculos c
       JOIN periodos p ON p.id = c.periodo_id JOIN tipos_nomina t ON t.clave = p.tipo_nomina WHERE c.id = :id`,
      { replacements: { id: calculoId }, type: QueryTypes.SELECT },
    );
    if (!fila) throw new NotFoundException('El cálculo no existe');
    const tipo = { prenomina: 'Prenómina', nomina: 'Nómina', aguinaldo: 'Aguinaldo', prima_vacacional: 'Prima vacacional' }[fila.tipo] ?? fila.tipo;
    return `${fila.nomina} · ${nombreQuincena(fila.anio, fila.quincena)} · ${tipo}`;
  }
}
