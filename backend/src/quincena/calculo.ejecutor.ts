import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions } from 'sequelize';
import { Calculo, Periodo, Recibo, ReciboConcepto } from '../database/models/nomina.models';
import { DescuentoPlazo, Empleado, EmpleadoConcepto } from '../database/models/personal.models';
import { calcularRecibo, ModoCalculo } from '../motor/motor';
import type { TablasMotor } from '../motor/tipos';
import { type ContextoCalculo, EntradaService } from '../common/entrada.service';

/**
 * Ejecuta un cálculo completo. Lo llama el worker, nunca la API: con miles de empleados tarda, y
 * así la API sigue respondiendo. Procesa por lotes y guarda el avance de cada uno, de modo que la
 * pantalla muestra el progreso y un worker caído no deja recibos a medias (se reintenta desde cero).
 */
@Injectable()
export class CalculoEjecutor {
  private readonly logger = new Logger(CalculoEjecutor.name);
  private readonly lote: number;

  constructor(
    config: ConfigService,
    private readonly entrada: EntradaService,
    @InjectModel(Calculo) private readonly calculos: typeof Calculo,
    @InjectModel(Periodo) private readonly periodos: typeof Periodo,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
    @InjectModel(Recibo) private readonly recibos: typeof Recibo,
    @InjectModel(ReciboConcepto) private readonly conceptosRecibo: typeof ReciboConcepto,
  ) {
    this.lote = config.get<number>('operacion.workerLote') ?? 250;
  }

  /**
   * @param ultimoIntento si falla y ya no habrá reintento, el cálculo queda en `error`; si no, vuelve
   *   a `en_cola` para que el siguiente intento de BullMQ lo tome.
   */
  async ejecutar(calculoId: number, avance?: (porcentaje: number) => Promise<void>, ultimoIntento = true) {
    const calculo = await this.calculos.findByPk(calculoId, { include: [Periodo] });
    if (!calculo || !['en_cola', 'procesando'].includes(calculo.estado)) return;
    const periodo = calculo.periodo;
    const modo: ModoCalculo = calculo.tipo === 'aguinaldo' || calculo.tipo === 'prima_vacacional' ? calculo.tipo : 'quincenal';

    try {
      // Reintento: se borra lo que haya dejado un intento anterior.
      await this.recibos.destroy({ where: { calculoId } });
      const ctx = await this.entrada.contexto(periodo, modo);
      const { tablas } = ctx;
      this.validarTablas(tablas, modo);
      if (ctx.ajustes.length) this.logger.log(`Cálculo ${calculoId}: ajustes de la quincena: ${ctx.ajustes.join('; ')}.`);
      // Evidencia: con qué se calculó. Aunque después cambien los catálogos, aquí queda lo que se usó.
      await calculo.update({ tablas: evidencia(ctx) });

      const where = this.universo(periodo, modo);
      const total = await this.empleados.count({ where });
      await calculo.update({ estado: 'procesando', iniciadoEl: new Date(), totalEmpleados: total, procesados: 0, error: null });

      let ultimoId = 0;
      let procesados = 0;
      const totales = { p: 0, d: 0, n: 0 };

      for (;;) {
        const lote = await this.empleados.findAll({
          where: { ...where, id: { [Op.gt]: ultimoId } },
          include: [
            { model: EmpleadoConcepto },
            { model: DescuentoPlazo, where: { activo: true }, required: false },
          ],
          order: [['id', 'ASC']],
          limit: this.lote,
        });
        if (lote.length === 0) break;
        ultimoId = lote[lote.length - 1].id;

        const filas = (await this.entrada.entradas(ctx, lote)).map(({ empleado, tab, entrada }) => {
          const resultado = calcularRecibo(entrada, tablas, modo);
          if (!tab) resultado.observaciones.unshift(`Nivel ${empleado.nivel} rango ${empleado.rango} no está en el tabulador.`);
          if (!empleado.pagoCheque && !empleado.cuentaBancaria) resultado.observaciones.push('Sin cuenta bancaria.');
          return { empleado, tab, entrada, resultado };
        });

        await this.recibos.sequelize!.transaction(async (transaction) => {
          const creados = await this.recibos.bulkCreate(
            filas.map(({ empleado, tab, entrada, resultado: r }) => ({
              calculoId,
              empleadoId: empleado.id,
              nombre: empleado.nombreCompleto,
              curp: empleado.curp,
              rfc: empleado.rfc,
              adscripcionId: empleado.adscripcionId,
              puestoClave: empleado.puestoClave,
              nivel: empleado.nivel,
              rango: empleado.rango,
              dias: r.dias,
              baseIsr: r.baseIsr,
              baseIssemym: r.baseIssemym,
              isrCausado: r.isrCausado,
              subsidio: r.subsidio,
              totalPercepciones: r.totalPercepciones,
              totalDeducciones: r.totalDeducciones,
              neto: r.neto,
              cuentaBancaria: empleado.cuentaBancaria,
              pagoCheque: empleado.pagoCheque,
              observaciones: r.observaciones.length ? r.observaciones : null,
              datos: {
                numeroIssemym: empleado.numeroIssemym,
                sci: empleado.sci,
                sindicalizado: empleado.sindicalizado,
                banco: empleado.banco,
                fechaAlta: empleado.fechaAlta,
                tabulador: tab
                  ? { vigencia: tab.vigencia, sueldoMensual: tab.sueldoMensual, compensacionMensual: tab.compensacionMensual, gratificacionMensual: tab.gratificacionMensual }
                  : null,
                baseTarifaIsr: r.baseTarifa,
                primeraQuincena: entrada.primeraQuincena ?? null,
                baseIssemymRetro: r.baseIssemymRetro,
              },
            })),
            { transaction, returning: ['id', 'empleado_id'] as unknown as true },
          );
          const idPorEmpleado = new Map(creados.map((c) => [c.empleadoId, c.id]));
          await this.conceptosRecibo.bulkCreate(
            filas.flatMap(({ empleado, resultado }) =>
              resultado.lineas.map((l) => ({ reciboId: idPorEmpleado.get(empleado.id), ...l })),
            ),
            { transaction },
          );
        });

        for (const { resultado } of filas) {
          totales.p += Math.round(resultado.totalPercepciones * 100);
          totales.d += Math.round(resultado.totalDeducciones * 100);
          totales.n += Math.round(resultado.neto * 100);
        }
        procesados += lote.length;
        await calculo.update({ procesados });
        await avance?.(total ? Math.round((procesados / total) * 100) : 100);
      }

      await this.calculos.sequelize!.transaction(async (transaction) => {
        await this.calculos.update(
          { estado: 'reemplazado' },
          { where: { periodoId: periodo.id, tipo: calculo.tipo, estado: 'terminado', id: { [Op.ne]: calculoId } }, transaction },
        );
        await calculo.update(
          {
            estado: 'terminado',
            terminadoEl: new Date(),
            totalPercepciones: totales.p / 100,
            totalDeducciones: totales.d / 100,
            totalNeto: totales.n / 100,
          },
          { transaction },
        );
        const siguiente = calculo.tipo === 'nomina' ? 'nomina' : calculo.tipo === 'prenomina' && periodo.estado === 'captura' ? 'prenomina' : null;
        if (siguiente) await periodo.update({ estado: siguiente }, { transaction });
      });
      this.logger.log(`Cálculo ${calculoId} (${calculo.tipo}) terminado: ${procesados} recibos.`);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cálculo ${calculoId} falló: ${mensaje}`, error instanceof Error ? error.stack : undefined);
      // Lo que se alcanzó a guardar de este intento no sirve: se borra (recibo_conceptos se va en cascada).
      await this.recibos.destroy({ where: { calculoId } });
      await calculo.update(
        ultimoIntento
          ? { estado: 'error', error: mensaje, terminadoEl: new Date() }
          : { estado: 'en_cola', error: `Reintentando tras: ${mensaje}`, procesados: 0 },
      );
      throw error;
    }
  }

  /** Quiénes entran al cálculo. Quincenal: los que estuvieron de alta algún día de la quincena. */
  private universo(periodo: Periodo, modo: ModoCalculo): WhereOptions<Empleado> {
    if (modo === 'quincenal') {
      return {
        tipoNomina: periodo.tipoNomina,
        fechaAlta: { [Op.lte]: periodo.fechaFin },
        [Op.or]: [{ fechaBaja: null }, { fechaBaja: { [Op.gte]: periodo.fechaInicio } }],
      };
    }
    return { tipoNomina: periodo.tipoNomina, estado: { [Op.ne]: 'baja' } };
  }

  private validarTablas(tablas: TablasMotor, modo: ModoCalculo) {
    const faltan = (modo === 'quincenal' ? (['sueldo', 'isr'] as const) : ([modo, 'isr'] as const)).filter(
      (c) => !tablas.calculados[c],
    );
    if (faltan.length) {
      throw new Error(`Falta indicar en el catálogo de conceptos cuál es: ${faltan.join(', ')}.`);
    }
  }
}

/** Copia de parámetros, tarifas, tabulador y claves usados en el cálculo. */
function evidencia(ctx: ContextoCalculo): Record<string, unknown> {
  const { tablas } = ctx;
  return {
    parametros: tablas.parametros,
    isr: tablas.isr.map((f) => ({ limiteInferior: f.limiteInferior, cuotaFija: f.cuotaFija, porcentaje: f.porcentaje })),
    subsidio: tablas.subsidio.map((f) => ({ ingresoDesde: f.ingresoDesde, subsidio: f.subsidio })),
    tabulador: [...ctx.tabulador.values()].map((t) => [t.vigencia, t.nivel, t.rango, t.sueldoMensual, t.gratificacionMensual, t.compensacionMensual]),
    claves: [...tablas.conceptos.values()].map((c) => [c.clave, c.naturaleza, c.gravaIsr, c.factorIssemym, c.timbra, c.calculado]),
    ajustes: ctx.ajustes,
  };
}
