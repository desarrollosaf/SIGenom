import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { Queue } from 'bullmq';
import { Op, Sequelize, WhereOptions } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { contiene, patron } from '../common/busqueda';
import { COLA_CALCULOS } from '../config/conexiones';
import { Adscripcion, Concepto, Puesto } from '../database/models/catalogos.models';
import { Calculo, Periodo, Recibo, ReciboConcepto, TipoCalculo } from '../database/models/nomina.models';
import { PeriodosService, vistaCalculo } from './periodos.service';

export interface TrabajoCalculo {
  calculoId: number;
}

@Injectable()
export class CalculosService {
  constructor(
    @InjectQueue(COLA_CALCULOS) private readonly cola: Queue<TrabajoCalculo>,
    private readonly periodos: PeriodosService,
    private readonly bitacora: BitacoraService,
    @InjectModel(Calculo) private readonly calculos: typeof Calculo,
    @InjectModel(Recibo) private readonly modeloRecibo: typeof Recibo,
    @InjectModel(Adscripcion) private readonly adscripciones: typeof Adscripcion,
    @InjectModel(Puesto) private readonly puestos: typeof Puesto,
  ) {}

  /** Encola el cálculo; el worker lo procesa y va guardando su avance. */
  async solicitar(periodoId: number, tipo: TipoCalculo, usuario: string) {
    const periodo = await this.periodos.abierto(periodoId);
    const enCurso = await this.calculos.findOne({ where: { periodoId, estado: { [Op.in]: ['en_cola', 'procesando'] } } });
    if (enCurso) throw new ConflictException('Ya hay un cálculo en curso para esta quincena.');
    if (tipo === 'nomina' && periodo.estado === 'captura') {
      const prenomina = await this.calculos.count({ where: { periodoId, tipo: 'prenomina', estado: 'terminado' } });
      if (!prenomina) throw new BadRequestException('Calcula y revisa la prenómina antes de la nómina definitiva.');
    }
    const calculo = await this.calculos.create({ periodoId, tipo, estado: 'en_cola', solicitadoPor: usuario });
    await this.cola.add('calcular', { calculoId: calculo.id }, { jobId: `calculo-${calculo.id}`, attempts: 2, backoff: { type: 'fixed', delay: 5000 } });
    await this.bitacora.registrar({ usuario, entidad: 'periodo', entidadId: periodoId, accion: `calcula_${tipo}`, despues: { calculo: calculo.id } });
    return vistaCalculo(calculo);
  }

  async ver(id: number) {
    return vistaCalculo(await this.buscar(id));
  }

  async buscar(id: number) {
    const calculo = await this.calculos.findByPk(id, { include: [Periodo] });
    if (!calculo) throw new NotFoundException('El cálculo no existe');
    return calculo;
  }

  async recibos(calculoId: number, filtro: { q?: string; desde?: number; limite?: number; soloObservados?: boolean }) {
    const condiciones: WhereOptions<Recibo>[] = [{ calculoId }];
    const q = filtro.q?.trim();
    if (q) {
      condiciones.push({
        [Op.or]: [contiene(Sequelize.col('nombre'), q), { curp: { [Op.iLike]: patron(q) } }, { rfc: { [Op.iLike]: patron(q) } }],
      });
    }
    if (filtro.soloObservados) {
      condiciones.push(Sequelize.literal("jsonb_array_length(coalesce(observaciones, '[]'::jsonb)) > 0"));
    }
    const where: WhereOptions<Recibo> = { [Op.and]: condiciones };
    const [{ rows, count }, adscripciones] = await Promise.all([
      this.modeloRecibo.findAndCountAll({ where, order: [['nombre', 'ASC']], limit: Math.min(filtro.limite ?? 50, 500), offset: filtro.desde ?? 0 }),
      this.nombresAdscripcion(),
    ]);
    return {
      total: count,
      recibos: rows.map((r) => ({
        id: r.id,
        empleadoId: r.empleadoId,
        nombre: r.nombre,
        curp: r.curp,
        adscripcion: adscripciones.get(r.adscripcionId) ?? String(r.adscripcionId),
        nivel: r.nivel,
        rango: r.rango,
        dias: r.dias,
        totalPercepciones: r.totalPercepciones,
        totalDeducciones: r.totalDeducciones,
        neto: r.neto,
        observaciones: r.observaciones ?? [],
      })),
    };
  }

  async recibo(id: number) {
    const recibo = await this.modeloRecibo.findByPk(id, {
      include: [
        { model: ReciboConcepto, include: [{ model: Concepto, attributes: ['claveIssemym'] }] },
        { model: Calculo, include: [Periodo] },
      ],
      order: [[{ model: ReciboConcepto, as: 'conceptos' }, 'naturaleza', 'DESC'], [{ model: ReciboConcepto, as: 'conceptos' }, 'clave', 'ASC']],
    });
    if (!recibo) throw new NotFoundException('El recibo no existe');
    const [adscripcion, puesto] = await Promise.all([
      this.adscripciones.findByPk(recibo.adscripcionId),
      this.puestos.findByPk(recibo.puestoClave),
    ]);
    return {
      id: recibo.id,
      calculo: vistaCalculo(recibo.calculo),
      periodo: this.periodos.vista(recibo.calculo.periodo),
      empleadoId: recibo.empleadoId,
      nombre: recibo.nombre,
      curp: recibo.curp,
      rfc: recibo.rfc,
      adscripcion: adscripcion?.descripcion ?? String(recibo.adscripcionId),
      puesto: puesto?.descripcion ?? recibo.puestoClave,
      nivel: recibo.nivel,
      rango: recibo.rango,
      dias: recibo.dias,
      baseIsr: recibo.baseIsr,
      baseIssemym: recibo.baseIssemym,
      isrCausado: recibo.isrCausado,
      subsidio: recibo.subsidio,
      totalPercepciones: recibo.totalPercepciones,
      totalDeducciones: recibo.totalDeducciones,
      neto: recibo.neto,
      cuentaBancaria: recibo.cuentaBancaria,
      pagoCheque: recibo.pagoCheque,
      observaciones: recibo.observaciones ?? [],
      conceptos: recibo.conceptos.map((c) => ({
        clave: c.clave,
        // Clave GEM del comprobante (Cata-pd.cve-iss).
        claveGem: c.concepto?.claveIssemym ?? null,
        descripcion: c.descripcion,
        naturaleza: c.naturaleza,
        importe: c.importe,
        gravadoIsr: c.gravadoIsr,
      })),
    };
  }

  /** Para el PDF masivo de comprobantes: ids de los recibos del cálculo, en orden alfabético. */
  async idsRecibos(calculoId: number) {
    const filas = await this.modeloRecibo.findAll({ where: { calculoId }, attributes: ['id'], order: [['nombre', 'ASC']] });
    return filas.map((f) => f.id);
  }

  private async nombresAdscripcion() {
    const filas = await this.adscripciones.findAll({ attributes: ['id', 'descripcion'] });
    return new Map(filas.map((a) => [a.id, a.descripcion]));
  }
}
