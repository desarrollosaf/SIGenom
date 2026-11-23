import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { hoyMexico, nombreQuincena } from '../common/fechas';
import { EntradaService } from '../common/entrada.service';
import { TablasService } from '../common/tablas.service';
import { Captura, Periodo } from '../database/models/nomina.models';
import { DescuentoPlazo, Empleado, EmpleadoConcepto, MovimientoPersonal } from '../database/models/personal.models';
import { calcularRecibo, diasPagables } from '../motor/motor';
import { fechasDeQuincena, quincenaDeFecha } from '../motor/periodos';

export type OrigenClave = 'calculado' | 'fija' | 'plazo' | 'captura';

/**
 * Cómo queda la quincena en curso de una persona, con todas sus claves juntas y de dónde sale cada
 * una. Usa el mismo motor que el worker y no guarda nada: es lo que mostraba la pantalla de
 * captura del sistema anterior (1CAP-Q-N.W) antes de calcular.
 */
@Injectable()
export class QuincenaEmpleadoService {
  constructor(
    private readonly tablas: TablasService,
    private readonly entrada: EntradaService,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
    @InjectModel(Periodo) private readonly periodos: typeof Periodo,
    @InjectModel(Captura) private readonly capturas: typeof Captura,
    @InjectModel(MovimientoPersonal) private readonly movimientos: typeof MovimientoPersonal,
  ) {}

  async estimar(id: number) {
    const empleado = await this.empleados.findByPk(id, {
      include: [{ model: EmpleadoConcepto }, { model: DescuentoPlazo, where: { activo: true }, required: false }],
    });
    if (!empleado) throw new NotFoundException('El empleado no existe');

    // La quincena abierta de su nómina; si no hay, la que corresponde a hoy.
    const periodo = await this.periodos.findOne({
      where: { tipoNomina: empleado.tipoNomina, estado: { [Op.ne]: 'cerrado' } },
      order: [['anio', 'ASC'], ['quincena', 'ASC']],
    });
    const q = periodo ?? quincenaDeFecha(hoyMexico());
    const fechas = periodo ? { inicio: periodo.fechaInicio, fin: periodo.fechaFin } : fechasDeQuincena(q.anio, q.quincena);

    const [tab, capturas, permisos, tablas] = await Promise.all([
      this.tablas.tabuladorVigente(fechas.fin).then((t) => t.get(`${empleado.nivel}-${empleado.rango}`) ?? null),
      periodo ? this.capturas.findAll({ where: { periodoId: periodo.id, empleadoId: id } }) : Promise.resolve([] as Captura[]),
      this.movimientos.findAll({
        where: {
          empleadoId: id,
          tipo: 'permiso',
          cancelado: false,
          fechaInicio: { [Op.lte]: fechas.fin },
          [Op.or]: [{ fechaFin: null }, { fechaFin: { [Op.gte]: fechas.inicio } }],
        },
      }),
      this.tablas.paraNomina(empleado.tipoNomina, fechas.fin),
    ]);
    if (periodo) await this.tablas.aplicarAjustes(tablas, periodo.id);
    const primeraQuincena = periodo ? ((await this.entrada.primerasQuincenas(periodo, [id])).get(id) ?? null) : null;

    const fijos = empleado.conceptosFijos.map((f) => ({ conceptoId: f.conceptoId, importe: f.importe, gravaIsr: f.gravaIsr, timbra: f.timbra }));
    const plazos = empleado.descuentosPlazo
      .filter((d) => d.quincenasPendientes === null || d.quincenasPendientes > 0)
      .map((d) => ({ conceptoId: d.conceptoId, importeQuincenal: d.importeQuincenal, porcentaje: d.porcentaje }));
    const capturados = capturas.map((c) => ({ conceptoId: c.conceptoId, importe: c.importe, gravaIsr: c.gravaIsr, timbra: c.timbra }));

    const resultado = calcularRecibo(
      {
        empleadoId: id,
        sueldoMensual: tab?.sueldoMensual ?? 0,
        compensacionMensual: tab?.compensacionMensual ?? 0,
        gratificacionMensual: tab?.gratificacionMensual ?? 0,
        sci: empleado.sci,
        primeraQuincena,
        dias: diasPagables(fechas, empleado, permisos.map((p) => ({ inicio: p.fechaInicio, fin: p.fechaFin })), tablas.parametros.diasQuincena),
        fijos,
        capturas: capturados,
        descuentosPlazo: plazos,
      },
      tablas,
    );
    if (!tab) resultado.observaciones.unshift(`Nivel ${empleado.nivel} rango ${empleado.rango} no está en el tabulador: no se le calcula sueldo.`);

    // De dónde sale cada línea. Una clave puede venir de dos lados (fija y además capturada).
    const origenes = (conceptoId: number): OrigenClave[] => {
      const lista: OrigenClave[] = [];
      if (tablas.conceptos.get(conceptoId)?.calculado) lista.push('calculado');
      if (fijos.some((f) => f.conceptoId === conceptoId)) lista.push('fija');
      if (plazos.some((p) => p.conceptoId === conceptoId)) lista.push('plazo');
      if (capturados.some((c) => c.conceptoId === conceptoId)) lista.push('captura');
      return lista;
    };

    return {
      periodo: { id: periodo?.id ?? null, nombre: nombreQuincena(q.anio, q.quincena), estado: periodo?.estado ?? null },
      dias: resultado.dias,
      lineas: resultado.lineas.map((l) => ({ ...l, origenes: origenes(l.conceptoId) })),
      baseIsr: resultado.baseIsr,
      baseIssemym: resultado.baseIssemym,
      isrCausado: resultado.isrCausado,
      subsidio: resultado.subsidio,
      totalPercepciones: resultado.totalPercepciones,
      totalDeducciones: resultado.totalDeducciones,
      neto: resultado.neto,
      observaciones: resultado.observaciones,
    };
  }
}
