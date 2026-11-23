import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes } from 'sequelize';
import { TablasService } from './tablas.service';
import type { Tabulador } from '../database/models/catalogos.models';
import { Captura, Periodo } from '../database/models/nomina.models';
import { Empleado, MovimientoPersonal } from '../database/models/personal.models';
import { diasPagables, ModoCalculo } from '../motor/motor';
import type { EmpleadoMotor, TablasMotor } from '../motor/tipos';

export interface ContextoCalculo {
  periodo: Periodo;
  modo: ModoCalculo;
  tablas: TablasMotor;
  tabulador: Map<string, Tabulador>;
  /** Ajustes de claves de la quincena, para la bitácora del cálculo. */
  ajustes: string[];
}

/**
 * Arma lo que el motor necesita de cada empleado. Lo usan el worker y las pantallas que calculan a
 * una sola persona (ajuste de neto), para que las dos den exactamente lo mismo.
 */
@Injectable()
export class EntradaService {
  constructor(
    private readonly tablas: TablasService,
    @InjectModel(Captura) private readonly capturas: typeof Captura,
    @InjectModel(MovimientoPersonal) private readonly movimientos: typeof MovimientoPersonal,
  ) {}

  async contexto(periodo: Periodo, modo: ModoCalculo): Promise<ContextoCalculo> {
    const tablas = await this.tablas.paraNomina(periodo.tipoNomina, periodo.fechaFin, modo === 'quincenal' ? undefined : 'Q');
    const ajustes = await this.tablas.aplicarAjustes(tablas, periodo.id);
    return { periodo, modo, tablas, ajustes, tabulador: await this.tablas.tabuladorVigente(periodo.fechaFin) };
  }

  /** Los empleados deben traer conceptosFijos y descuentosPlazo activos. */
  async entradas(ctx: ContextoCalculo, empleados: Empleado[]) {
    const { periodo, modo, tablas, tabulador } = ctx;
    const ids = empleados.map((e) => e.id);
    if (!ids.length) return [];
    const [capturas, permisos, primeras] = await Promise.all([
      modo === 'quincenal' ? this.capturas.findAll({ where: { periodoId: periodo.id, empleadoId: ids } }) : Promise.resolve([] as Captura[]),
      this.movimientos.findAll({
        where: {
          empleadoId: ids,
          tipo: 'permiso',
          cancelado: false,
          fechaInicio: { [Op.lte]: periodo.fechaFin },
          [Op.or]: [{ fechaFin: null }, { fechaFin: { [Op.gte]: periodo.fechaInicio } }],
        },
      }),
      modo === 'quincenal' ? this.primerasQuincenas(periodo, ids) : Promise.resolve(new Map<number, { baseIsr: number; isr: number }>()),
    ]);
    const agrupar = <T extends { empleadoId: number }>(l: T[]) => {
      const m = new Map<number, T[]>();
      for (const x of l) m.set(x.empleadoId, [...(m.get(x.empleadoId) ?? []), x]);
      return m;
    };
    const capturasDe = agrupar(capturas);
    const permisosDe = agrupar(permisos);

    return empleados.map((empleado) => {
      const tab = tabulador.get(`${empleado.nivel}-${empleado.rango}`) ?? null;
      const entrada: EmpleadoMotor = {
        empleadoId: empleado.id,
        sueldoMensual: tab?.sueldoMensual ?? 0,
        compensacionMensual: tab?.compensacionMensual ?? 0,
        gratificacionMensual: tab?.gratificacionMensual ?? 0,
        sci: empleado.sci,
        primeraQuincena: primeras.get(empleado.id) ?? null,
        dias: diasPagables(
          { inicio: periodo.fechaInicio, fin: periodo.fechaFin },
          empleado,
          (permisosDe.get(empleado.id) ?? []).map((p) => ({ inicio: p.fechaInicio, fin: p.fechaFin })),
          tablas.parametros.diasQuincena,
        ),
        fijos: empleado.conceptosFijos.map((f) => ({ conceptoId: f.conceptoId, importe: f.importe })),
        capturas: (capturasDe.get(empleado.id) ?? []).map((c) => ({ conceptoId: c.conceptoId, importe: c.importe })),
        descuentosPlazo:
          modo === 'quincenal'
            ? empleado.descuentosPlazo
                .filter((d) => d.quincenasPendientes === null || d.quincenasPendientes > 0)
                .map((d) => ({ conceptoId: d.conceptoId, importeQuincenal: d.importeQuincenal, porcentaje: d.porcentaje }))
            : [],
        proporcionAnual: proporcionAnual(periodo.anio, empleado),
      };
      return { empleado, tab, entrada };
    });
  }

  /**
   * En la 2a quincena del mes: base gravable e ISR retenido en la 1a, de lo que se pagó: la nómina
   * definitiva de SIGenom o, si esa quincena no se calculó aquí, los recibos del sistema anterior.
   */
  async primerasQuincenas(periodo: Periodo, ids: number[]) {
    const mapa = new Map<number, { baseIsr: number; isr: number }>();
    if (periodo.quincena % 2 !== 0) return mapa;
    const filas = await this.capturas.sequelize!.query<{ empleado_id: number; base: number; isr: number }>(
      `WITH pagado AS (
         SELECT c.id FROM calculos c JOIN periodos p ON p.id = c.periodo_id
         WHERE p.tipo_nomina = :tipo AND p.anio = :anio AND p.quincena = :quincena AND c.estado = 'terminado'
           AND (c.tipo = 'nomina' OR (c.tipo = 'legado' AND c.error IS NULL))
         ORDER BY (c.tipo = 'nomina') DESC, c.id DESC LIMIT 1)
       SELECT r.empleado_id, r.base_isr::float base,
              coalesce((SELECT sum(rc.importe) FROM recibo_conceptos rc JOIN conceptos k ON k.id = rc.concepto_id
                        WHERE rc.recibo_id = r.id AND k.calculado = 'isr'), 0)::float isr
       FROM recibos r WHERE r.calculo_id = (SELECT id FROM pagado) AND r.empleado_id IN (:ids) AND r.total_percepciones > 0`,
      { type: QueryTypes.SELECT, replacements: { tipo: periodo.tipoNomina, anio: periodo.anio, quincena: periodo.quincena - 1, ids } },
    );
    for (const f of filas) mapa.set(f.empleado_id, { baseIsr: f.base, isr: f.isr });
    return mapa;
  }
}

/** Parte del año que trabajó el empleado, para aguinaldo proporcional. */
function proporcionAnual(anio: number, empleado: { fechaAlta: string; fechaBaja: string | null }) {
  const inicioAnio = `${anio}-01-01`;
  const finAnio = `${anio}-12-31`;
  const desde = empleado.fechaAlta > inicioAnio ? empleado.fechaAlta : inicioAnio;
  const hasta = empleado.fechaBaja && empleado.fechaBaja < finAnio ? empleado.fechaBaja : finAnio;
  if (desde > hasta) return 0;
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000 + 1;
  const total = (Date.parse(finAnio) - Date.parse(inicioAnio)) / 86_400_000 + 1;
  return Math.min(1, dias / total);
}
