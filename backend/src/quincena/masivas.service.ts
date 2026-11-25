import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { EntradaService } from '../common/entrada.service';
import { Concepto } from '../database/models/catalogos.models';
import { Captura, CapturaMasiva, Periodo } from '../database/models/nomina.models';
import { DescuentoPlazo, Empleado, EmpleadoConcepto } from '../database/models/personal.models';
import { calcularRecibo } from '../motor/motor';
import { PeriodosService } from './periodos.service';

const LOTE = 400;

export interface FiltroMasiva {
  adscripciones?: number[];
  nivelDesde?: number;
  nivelHasta?: number;
  /** No volver a ponerle la clave a quien ya la tiene en esta quincena. */
  omitirConClave: boolean;
  /** Solo a quien cobra algo en esta quincena (deja fuera licencias sin goce y quincenas sin días). */
  soloConPago: boolean;
}

export interface DatosMasiva {
  conceptoId: number;
  importe: number;
  gravaIsr?: boolean | null;
  timbra?: boolean | null;
  referencia?: string;
  filtro: FiltroMasiva;
}

/**
 * La misma clave a muchas personas (el bono de navidad, un descuento general). Primero se ve a cuántas y
 * cuánto cuesta, calculado con el mismo motor de la nómina; después se captura, y se puede deshacer junta.
 */
@Injectable()
export class MasivasService {
  constructor(
    private readonly periodos: PeriodosService,
    private readonly entrada: EntradaService,
    private readonly bitacora: BitacoraService,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
    @InjectModel(Captura) private readonly capturas: typeof Captura,
    @InjectModel(CapturaMasiva) private readonly masivas: typeof CapturaMasiva,
  ) {}

  async listar(periodoId: number) {
    await this.periodos.buscar(periodoId);
    const filas = await this.masivas.findAll({ where: { periodoId }, include: [Concepto], order: [['id', 'DESC']] });
    return filas.map((m) => ({
      id: m.id,
      clave: m.concepto.clave,
      descripcion: m.concepto.descripcion,
      naturaleza: m.concepto.naturaleza,
      importe: m.importe,
      gravaIsr: m.gravaIsr ?? m.concepto.gravaIsr,
      timbra: m.timbra ?? m.concepto.timbra,
      referencia: m.referencia,
      personas: m.personas,
      registradoPor: m.registradoPor,
      creadaEl: m.createdAt,
      deshechoPor: m.deshechoPor,
      deshechoEl: m.deshechoEl,
    }));
  }

  async vista(periodoId: number, datos: DatosMasiva) {
    const periodo = await this.periodos.abierto(periodoId);
    const concepto = await this.validar(periodo, datos);
    const { ids, ...resumen } = await this.calcular(periodo, datos);
    return { ...resumen, personas: ids.length, total: Math.round(ids.length * datos.importe * 100) / 100, naturaleza: concepto.naturaleza, cotiza: concepto.factorIssemym > 0 };
  }

  /** @param personas las que se vieron en la vista previa: si ya no son las mismas, no se captura. */
  async aplicar(periodoId: number, datos: DatosMasiva, personas: number, usuario: string) {
    const periodo = await this.periodos.abierto(periodoId);
    const concepto = await this.validar(periodo, datos);
    const { ids } = await this.calcular(periodo, datos);
    const db = this.capturas.sequelize!;
    return db.transaction(async (transaction) => {
      // De una en una por quincena: dos clics o dos personas a la vez no la capturan doble.
      await db.query('SELECT pg_advisory_xact_lock(7301, :periodoId)', { replacements: { periodoId }, transaction });
      let destinatarios = ids;
      if (datos.filtro.omitirConClave) {
        const yaTienen = new Set(
          (await this.capturas.findAll({ where: { periodoId, conceptoId: concepto.id }, attributes: ['empleadoId'], transaction })).map((c) => c.empleadoId),
        );
        destinatarios = ids.filter((id) => !yaTienen.has(id));
      }
      if (destinatarios.length !== personas) {
        throw new ConflictException(`Cambió desde la vista previa: ahora serían ${destinatarios.length} personas. Vuelve a revisarla.`);
      }
      if (!destinatarios.length) throw new BadRequestException('No hay a quién capturarle.');
      const masiva = await this.masivas.create(
        {
          periodoId, conceptoId: concepto.id, importe: datos.importe, gravaIsr: datos.gravaIsr ?? null, timbra: datos.timbra ?? null,
          referencia: datos.referencia?.trim() || null, filtro: datos.filtro, personas: destinatarios.length, registradoPor: usuario,
        },
        { transaction },
      );
      for (let i = 0; i < destinatarios.length; i += 1000) {
        await this.capturas.bulkCreate(
          destinatarios.slice(i, i + 1000).map((empleadoId) => ({
            periodoId, empleadoId, conceptoId: concepto.id, importe: datos.importe, gravaIsr: datos.gravaIsr ?? null, timbra: datos.timbra ?? null,
            origen: 'masiva', referencia: datos.referencia?.trim() || 'Captura a varias personas', registradoPor: usuario, masivaId: masiva.id,
          })),
          { transaction },
        );
      }
      await this.bitacora.registrar(
        {
          usuario, entidad: 'periodo', entidadId: periodoId, accion: 'captura_masiva',
          despues: { masiva: masiva.id, conceptoId: concepto.id, importe: datos.importe, gravaIsr: datos.gravaIsr ?? null, timbra: datos.timbra ?? null, personas: destinatarios.length, filtro: datos.filtro },
        },
        transaction,
      );
      return { id: masiva.id, personas: destinatarios.length };
    });
  }

  async deshacer(periodoId: number, id: number, usuario: string) {
    await this.periodos.abierto(periodoId);
    return this.capturas.sequelize!.transaction(async (transaction) => {
      const masiva = await this.masivas.findOne({ where: { id, periodoId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!masiva) throw new NotFoundException('Esa captura no existe en esta quincena.');
      if (masiva.deshechoEl) throw new BadRequestException('Ya estaba deshecha.');
      const borradas = await this.capturas.destroy({ where: { masivaId: id, periodoId }, transaction });
      await masiva.update({ deshechoPor: usuario, deshechoEl: new Date() }, { transaction });
      await this.bitacora.registrar(
        { usuario, entidad: 'periodo', entidadId: periodoId, accion: 'deshace_captura_masiva', antes: { masiva: id, conceptoId: masiva.conceptoId, importe: masiva.importe, borradas } },
        transaction,
      );
      return { borradas };
    });
  }

  private async validar(periodo: Periodo, datos: DatosMasiva) {
    const concepto = await this.conceptos.findByPk(datos.conceptoId);
    if (!concepto || concepto.tipoNomina !== periodo.tipoNomina || !concepto.activo) throw new BadRequestException('La clave no pertenece a esta nómina.');
    if (concepto.calculado) throw new BadRequestException(`${concepto.descripcion} lo calcula el sistema.`);
    if (concepto.naturaleza === 'D' && datos.gravaIsr != null) throw new BadRequestException('Las deducciones no gravan ISR.');
    if (datos.filtro.nivelDesde && datos.filtro.nivelHasta && datos.filtro.nivelDesde > datos.filtro.nivelHasta) throw new BadRequestException('El nivel inicial es mayor que el final.');
    return concepto;
  }

  /** A quiénes, y cómo cambia el recibo de todos juntos. */
  private async calcular(periodo: Periodo, datos: DatosMasiva) {
    const { filtro, conceptoId, importe, gravaIsr, timbra } = datos;
    const ctx = await this.entrada.contexto(periodo, 'quincenal');
    const movimiento = { conceptoId, importe, gravaIsr, timbra };
    const ids: number[] = [];
    const suma = { isr: 0, issemym: 0, neto: 0 };
    const netos = { menor: Infinity, mayor: -Infinity };
    let conClave = 0;
    let sinPago = 0;
    let quedanNegativos = 0;
    let ultimoId = 0;
    for (;;) {
      const lote = await this.empleados.findAll({
        where: {
          id: { [Op.gt]: ultimoId },
          tipoNomina: periodo.tipoNomina,
          fechaAlta: { [Op.lte]: periodo.fechaFin },
          [Op.or]: [{ fechaBaja: null }, { fechaBaja: { [Op.gte]: periodo.fechaInicio } }],
          ...(filtro.adscripciones?.length ? { adscripcionId: filtro.adscripciones } : {}),
          ...(filtro.nivelDesde || filtro.nivelHasta ? { nivel: { [Op.between]: [filtro.nivelDesde ?? 0, filtro.nivelHasta ?? 999] } } : {}),
        },
        include: [{ model: EmpleadoConcepto }, { model: DescuentoPlazo, where: { activo: true }, required: false }],
        order: [['id', 'ASC']],
        limit: LOTE,
      });
      if (!lote.length) break;
      ultimoId = lote[lote.length - 1].id;
      for (const { empleado, entrada } of await this.entrada.entradas(ctx, lote)) {
        const tiene = entrada.capturas.some((c) => c.conceptoId === conceptoId) || entrada.fijos.some((f) => f.conceptoId === conceptoId);
        if (tiene) conClave++;
        if (tiene && filtro.omitirConClave) continue;
        const antes = calcularRecibo(entrada, ctx.tablas);
        if (antes.totalPercepciones <= 0) sinPago++;
        if (antes.totalPercepciones <= 0 && filtro.soloConPago) continue;
        const despues = calcularRecibo({ ...entrada, capturas: [...entrada.capturas, movimiento] }, ctx.tablas);
        const de = (r: typeof antes, ...cuales: string[]) =>
          r.lineas.reduce((s, l) => (cuales.includes(ctx.tablas.conceptos.get(l.conceptoId)?.calculado ?? '') ? s + Math.round(l.importe * 100) : s), 0);
        suma.isr += de(despues, 'isr') - de(antes, 'isr');
        const cuotas = ['issemym_salud', 'issemym_pension', 'issemym_salud_retro', 'issemym_pens_retro', 'sci', 'sci_retro'];
        suma.issemym += de(despues, ...cuotas) - de(antes, ...cuotas);
        const diferencia = Math.round((despues.neto - antes.neto) * 100);
        suma.neto += diferencia;
        netos.menor = Math.min(netos.menor, diferencia);
        netos.mayor = Math.max(netos.mayor, diferencia);
        if (despues.neto <= 0 && antes.neto > 0) quedanNegativos++;
        ids.push(empleado.id);
      }
    }
    return {
      ids,
      isr: suma.isr / 100,
      issemym: suma.issemym / 100,
      neto: suma.neto / 100,
      netoMenor: ids.length ? netos.menor / 100 : 0,
      netoMayor: ids.length ? netos.mayor / 100 : 0,
      conClave,
      sinPago,
      quedanNegativos,
    };
  }
}
