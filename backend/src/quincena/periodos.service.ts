import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { nombreQuincena } from '../common/fechas';
import { Concepto, TipoNomina } from '../database/models/catalogos.models';
import { Calculo, Captura, Periodo, PeriodoConcepto, Recibo, ReciboConcepto } from '../database/models/nomina.models';
import { DescuentoPlazo } from '../database/models/personal.models';
import { fechasDeQuincena, siguienteQuincena } from '../motor/periodos';

@Injectable()
export class PeriodosService {
  constructor(
    private readonly bitacora: BitacoraService,
    @InjectModel(Periodo) private readonly periodos: typeof Periodo,
    @InjectModel(Calculo) private readonly calculos: typeof Calculo,
    @InjectModel(Captura) private readonly capturas: typeof Captura,
    @InjectModel(Recibo) private readonly recibos: typeof Recibo,
    @InjectModel(DescuentoPlazo) private readonly plazos: typeof DescuentoPlazo,
    @InjectModel(TipoNomina) private readonly tipos: typeof TipoNomina,
    @InjectModel(PeriodoConcepto) private readonly ajustes: typeof PeriodoConcepto,
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
  ) {}

  // --- Ajustes de claves solo para esta quincena -----------------------------------------------

  /** Claves que en esta quincena gravan o se timbran distinto de lo que dice el catálogo. */
  async listarAjustes(id: number) {
    await this.buscar(id);
    const filas = await this.ajustes.findAll({ where: { periodoId: id }, include: [Concepto] });
    return filas
      .map((a) => ({
        conceptoId: a.conceptoId,
        clave: a.concepto.clave,
        descripcion: a.concepto.descripcion,
        naturaleza: a.concepto.naturaleza,
        catalogo: { gravaIsr: a.concepto.gravaIsr, timbra: a.concepto.timbra },
        gravaIsr: a.gravaIsr,
        timbra: a.timbra,
        motivo: a.motivo,
        registradoPor: a.registradoPor,
        actualizadoEl: a.updatedAt,
      }))
      .sort((a, b) => b.naturaleza.localeCompare(a.naturaleza) || a.clave - b.clave);
  }

  /**
   * Para esta quincena, la clave grava o no y se timbra o no (null = como el catálogo). Si los dos
   * quedan como el catálogo, el ajuste se borra. Vale a partir del siguiente cálculo.
   */
  async guardarAjuste(id: number, datos: { conceptoId: number; gravaIsr: boolean | null; timbra: boolean | null; motivo?: string }, usuario: string) {
    const periodo = await this.abierto(id);
    const concepto = await this.conceptos.findByPk(datos.conceptoId);
    if (!concepto || concepto.tipoNomina !== periodo.tipoNomina) {
      throw new BadRequestException('Esa clave no es de este tipo de nómina.');
    }
    const gravaIsr = datos.gravaIsr === concepto.gravaIsr ? null : datos.gravaIsr;
    const timbra = datos.timbra === concepto.timbra ? null : datos.timbra;
    if (gravaIsr !== null && concepto.naturaleza === 'D') throw new BadRequestException('Las deducciones no gravan ISR.');

    const anterior = await this.ajustes.findOne({ where: { periodoId: id, conceptoId: concepto.id } });
    await this.ajustes.sequelize!.transaction(async (transaction) => {
      if (gravaIsr === null && timbra === null) {
        await anterior?.destroy({ transaction });
      } else if (anterior) {
        await anterior.update({ gravaIsr, timbra, motivo: datos.motivo ?? null, registradoPor: usuario }, { transaction });
      } else {
        await this.ajustes.create({ periodoId: id, conceptoId: concepto.id, gravaIsr, timbra, motivo: datos.motivo ?? null, registradoPor: usuario }, { transaction });
      }
      await this.bitacora.registrar(
        {
          usuario,
          entidad: 'periodo',
          entidadId: id,
          accion: 'ajusta_clave',
          antes: anterior ? { clave: concepto.clave, gravaIsr: anterior.gravaIsr, timbra: anterior.timbra } : null,
          despues: { clave: concepto.clave, gravaIsr, timbra, motivo: datos.motivo ?? null },
        },
        transaction,
      );
    });
    return this.listarAjustes(id);
  }

  async listar(tipoNomina: string, anio?: number) {
    const filas = await this.periodos.findAll({
      where: { tipoNomina, ...(anio ? { anio } : {}) },
      order: [['anio', 'DESC'], ['quincena', 'DESC']],
      limit: 48,
    });
    return filas.map((p) => this.vista(p));
  }

  /** La quincena en curso del tipo de nómina: la más antigua que siga abierta. */
  async actual(tipoNomina: string) {
    const abierta = await this.periodos.findOne({
      where: { tipoNomina, estado: { [Op.ne]: 'cerrado' } },
      order: [['anio', 'ASC'], ['quincena', 'ASC']],
    });
    if (abierta) return this.vista(abierta);
    const ultima = await this.periodos.findOne({ where: { tipoNomina }, order: [['anio', 'DESC'], ['quincena', 'DESC']] });
    return ultima ? this.vista(ultima) : null;
  }

  async ver(id: number) {
    const periodo = await this.buscar(id);
    const [capturas, calculos] = await Promise.all([
      this.capturas.count({ where: { periodoId: id } }),
      this.calculos.findAll({ where: { periodoId: id }, order: [['id', 'DESC']] }),
    ]);
    return { ...this.vista(periodo), capturas, calculos: calculos.map((c) => vistaCalculo(c)) };
  }

  async crear(datos: { tipoNomina: string; anio: number; quincena: number; fechaPago?: string }, usuario: string) {
    if (!(await this.tipos.findByPk(datos.tipoNomina))) throw new BadRequestException('Ese tipo de nómina no existe.');
    const existe = await this.periodos.findOne({ where: { tipoNomina: datos.tipoNomina, anio: datos.anio, quincena: datos.quincena } });
    if (existe) throw new ConflictException('Esa quincena ya existe.');
    // Una sola quincena en curso por nómina: la siguiente se abre sola al cerrar la actual.
    const abierta = await this.periodos.findOne({ where: { tipoNomina: datos.tipoNomina, estado: { [Op.ne]: 'cerrado' } } });
    if (abierta) {
      throw new ConflictException(
        `Ya está abierta la ${nombreQuincena(abierta.anio, abierta.quincena)}. Ciérrala y la siguiente se abre sola.`,
      );
    }
    const ultimaCerrada = await this.periodos.findOne({
      where: { tipoNomina: datos.tipoNomina, estado: 'cerrado' },
      order: [['anio', 'DESC'], ['quincena', 'DESC']],
    });
    if (ultimaCerrada && datos.anio * 100 + datos.quincena < ultimaCerrada.anio * 100 + ultimaCerrada.quincena) {
      throw new BadRequestException(
        `No se puede abrir una quincena anterior a la última cerrada (${nombreQuincena(ultimaCerrada.anio, ultimaCerrada.quincena)}). Las correcciones van en la quincena en curso.`,
      );
    }
    const fechas = fechasDeQuincena(datos.anio, datos.quincena);
    const periodo = await this.periodos.create({
      ...datos,
      fechaInicio: fechas.inicio,
      fechaFin: fechas.fin,
      fechaPago: datos.fechaPago ?? fechas.fin,
      estado: 'captura',
    });
    await this.bitacora.registrar({ usuario, entidad: 'periodo', entidadId: periodo.id, accion: 'abre', despues: datos });
    return this.vista(periodo);
  }

  async cambiarFechaPago(id: number, fechaPago: string, usuario: string) {
    const periodo = await this.abierto(id);
    await periodo.update({ fechaPago });
    await this.bitacora.registrar({ usuario, entidad: 'periodo', entidadId: id, accion: 'fecha_pago', despues: { fechaPago } });
    return this.vista(periodo);
  }

  /**
   * Cierra la quincena: congela su nómina, descuenta una quincena a los descuentos a plazo que se
   * aplicaron y abre la siguiente. Equivale a "Respaldo de nómina" (RESP.W) del sistema anterior,
   * pero sin archivos: la quincena queda guardada y se consulta cuando se quiera.
   */
  async cerrar(id: number, usuario: string) {
    const periodo = await this.abierto(id);
    const nomina = await this.calculos.findOne({ where: { periodoId: id, tipo: 'nomina', estado: 'terminado' } });
    if (!nomina) throw new BadRequestException('Primero calcula la nómina definitiva de la quincena.');
    const posterior = await this.capturas.count({ where: { periodoId: id, updatedAt: { [Op.gt]: nomina.iniciadoEl ?? nomina.createdAt } } });
    if (posterior > 0) {
      throw new BadRequestException(`Hay ${posterior} capturas nuevas o modificadas después del último cálculo. Vuelve a calcular la nómina antes de cerrar.`);
    }
    if (await this.ajustes.count({ where: { periodoId: id, updatedAt: { [Op.gt]: nomina.iniciadoEl ?? nomina.createdAt } } })) {
      throw new BadRequestException('Cambiaste ajustes de claves después del último cálculo. Vuelve a calcular la nómina antes de cerrar.');
    }

    // Un neto negativo no se puede pagar; el sistema anterior tampoco lo dejaba pasar (1CAL-N-P.W).
    const negativos = await this.recibos.count({
      where: {
        calculoId: nomina.id,
        totalPercepciones: { [Op.gt]: 0 },
        neto: periodo.tipoNomina === 'D' ? { [Op.lt]: 0 } : { [Op.lte]: 0 },
      },
    });
    if (negativos > 0) {
      throw new BadRequestException(
        `Hay ${negativos} ${negativos === 1 ? 'recibo con neto negativo o en cero' : 'recibos con neto negativo o en cero'}. Corrígelos en Verificación, vuelve a calcular la nómina y cierra.`,
      );
    }

    await this.periodos.sequelize!.transaction(async (transaction) => {
      // Una quincena menos a cada descuento a plazo que sí se aplicó en esta nómina.
      const aplicados = (await this.recibos.findAll({
        where: { calculoId: nomina.id },
        attributes: ['empleadoId'],
        include: [{ model: ReciboConcepto, attributes: ['conceptoId'] }],
        transaction,
      })).flatMap((r) => r.conceptos.map((c) => `${r.empleadoId}:${c.conceptoId}`));
      const llaves = new Set(aplicados);
      const plazos = await this.plazos.findAll({ where: { activo: true, quincenasPendientes: { [Op.gt]: 0 } }, transaction });
      for (const plazo of plazos) {
        if (!llaves.has(`${plazo.empleadoId}:${plazo.conceptoId}`)) continue;
        const pendientes = (plazo.quincenasPendientes ?? 1) - 1;
        await plazo.update({ quincenasPendientes: pendientes, activo: pendientes > 0 }, { transaction });
      }

      await periodo.update({ estado: 'cerrado', cerradoPor: usuario, cerradoEl: new Date() }, { transaction });
      const sig = siguienteQuincena(periodo.anio, periodo.quincena);
      const existe = await this.periodos.findOne({ where: { tipoNomina: periodo.tipoNomina, ...sig }, transaction });
      if (!existe) {
        const fechas = fechasDeQuincena(sig.anio, sig.quincena);
        await this.periodos.create(
          { tipoNomina: periodo.tipoNomina, ...sig, fechaInicio: fechas.inicio, fechaFin: fechas.fin, fechaPago: fechas.fin, estado: 'captura' },
          { transaction },
        );
      }
      await this.bitacora.registrar({ usuario, entidad: 'periodo', entidadId: id, accion: 'cierra', despues: { calculo: nomina.id } }, transaction);
    });
    return this.vista(periodo);
  }

  async buscar(id: number) {
    const periodo = await this.periodos.findByPk(id);
    if (!periodo) throw new NotFoundException('La quincena no existe');
    return periodo;
  }

  async abierto(id: number) {
    const periodo = await this.buscar(id);
    if (periodo.estado === 'cerrado') throw new BadRequestException('La quincena ya está cerrada.');
    return periodo;
  }

  vista(p: Periodo) {
    return {
      id: p.id,
      tipoNomina: p.tipoNomina,
      anio: p.anio,
      quincena: p.quincena,
      nombre: nombreQuincena(p.anio, p.quincena),
      fechaInicio: p.fechaInicio,
      fechaFin: p.fechaFin,
      fechaPago: p.fechaPago,
      estado: p.estado,
      cerradoPor: p.cerradoPor,
      cerradoEl: p.cerradoEl,
    };
  }
}

export function vistaCalculo(c: Calculo) {
  return {
    id: c.id,
    periodoId: c.periodoId,
    tipo: c.tipo,
    estado: c.estado,
    totalEmpleados: c.totalEmpleados,
    procesados: c.procesados,
    totalPercepciones: c.totalPercepciones,
    totalDeducciones: c.totalDeducciones,
    totalNeto: c.totalNeto,
    error: c.error,
    solicitadoPor: c.solicitadoPor,
    iniciadoEl: c.iniciadoEl,
    terminadoEl: c.terminadoEl,
    creadoEl: c.createdAt,
  };
}
