import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, Sequelize } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { contiene, patron } from '../common/busqueda';
import { TablasService } from '../common/tablas.service';
import { Adscripcion, Concepto, Puesto } from '../database/models/catalogos.models';
import { EstadoExterno, LecturaExterna, MovimientoExterno, Sistema } from '../database/models/externos.models';
import { Captura } from '../database/models/nomina.models';
import { DescuentoPlazo, Empleado, EmpleadoConcepto } from '../database/models/personal.models';
import { EmpleadosService } from '../empleados/empleados.service';
import { MovimientosService } from '../empleados/movimientos.service';
import { CapturasService } from '../quincena/capturas.service';
import { PeriodosService } from '../quincena/periodos.service';
import { Lector, LECTORES, Renglon } from './lectores';
import { Accion, ConceptoPlan, Contexto, Plan, planear } from './planes';

/** Cuántos renglones se vuelven a mirar en cada lectura, por si otro sistema confirmó uno tarde. */
const TRASLAPE = 1000;
const POR_PAGINA = 100;
/** Si un movimiento sigue apartado después de esto, el servidor se detuvo a la mitad. */
const APARTADO_MS = 10 * 60_000;

/**
 * Trae a una bandeja los movimientos de otros sistemas y los aplica cuando alguien los revisa. Al otro
 * sistema solo se le lee: la conexión se abre de solo lectura y no se le escribe nada.
 */
@Injectable()
export class IntegracionesService {
  private readonly logger = new Logger(IntegracionesService.name);

  constructor(
    private readonly bitacora: BitacoraService,
    private readonly tablas: TablasService,
    private readonly periodos: PeriodosService,
    private readonly capturas: CapturasService,
    private readonly empleadosSrv: EmpleadosService,
    private readonly movimientosSrv: MovimientosService,
    @InjectModel(MovimientoExterno) private readonly externos: typeof MovimientoExterno,
    @InjectModel(LecturaExterna) private readonly lecturas: typeof LecturaExterna,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
    @InjectModel(Puesto) private readonly puestos: typeof Puesto,
    @InjectModel(Adscripcion) private readonly adscripciones: typeof Adscripcion,
    @InjectModel(DescuentoPlazo) private readonly plazos: typeof DescuentoPlazo,
    @InjectModel(Captura) private readonly capturasModelo: typeof Captura,
  ) {}

  async resumen() {
    const conteos = (await this.externos.findAll({
      attributes: ['sistema', 'estado', [Sequelize.fn('count', Sequelize.col('id')), 'total']],
      group: ['sistema', 'estado'],
      raw: true,
    })) as unknown as { sistema: Sistema; estado: EstadoExterno; total: string }[];
    return Promise.all(
      LECTORES.map(async (l) => {
        const ultima = await this.lecturas.findOne({ where: { sistema: l.clave }, order: [['id', 'DESC']] });
        const total = (e: EstadoExterno) => Number(conteos.find((c) => c.sistema === l.clave && c.estado === e)?.total ?? 0);
        return {
          clave: l.clave,
          nombre: l.nombre,
          descripcion: l.descripcion,
          tipos: l.tipos,
          conectado: !!this.conexionDe(l),
          pendientes: total('pendiente') + total('aplicando'),
          aplicados: total('aplicado'),
          descartados: total('descartado'),
          ultima: ultima ? { fecha: ultima.createdAt, usuario: ultima.usuario, nuevos: ultima.nuevos, error: ultima.error } : null,
        };
      }),
    );
  }

  /** Lee lo nuevo del otro sistema. Nada se aplica todavía. */
  async traer(sistema: string, usuario: string) {
    const lector = this.lector(sistema);
    const conexion = this.conexionDe(lector);
    if (!conexion) throw new BadRequestException(`Falta configurar la conexión con ${lector.nombre} en el servidor (docs/integraciones.md).`);
    const db = new Sequelize({
      dialect: 'postgres',
      ...conexion,
      logging: false,
      pool: { max: 1 },
      dialectOptions: { options: '-c default_transaction_read_only=on', connectionTimeoutMillis: 8000, statement_timeout: 30000 },
    });
    let nuevos = 0;
    try {
      const [{ ultimo }] = await this.externos.sequelize!.query<{ ultimo: string | null }>(
        'SELECT max(externo_id::bigint)::text ultimo FROM movimientos_externos WHERE sistema = :sistema',
        { type: QueryTypes.SELECT, replacements: { sistema: lector.clave } },
      );
      let desde = Math.max(0, Number(ultimo ?? 0) - TRASLAPE);
      for (;;) {
        const renglones = await db.query<Renglon>(lector.sql, { type: QueryTypes.SELECT, replacements: { desde } });
        if (!renglones.length) break;
        const leidos = renglones.map((r) => lector.leer(r));
        const vistos = new Set(
          (await this.externos.findAll({ where: { sistema: lector.clave, externoId: leidos.map((l) => l.externoId) }, attributes: ['externoId'] })).map((x) => x.externoId),
        );
        const faltan = leidos.filter((l) => !vistos.has(l.externoId));
        await this.externos.bulkCreate(faltan.map((l) => ({ ...l, sistema: lector.clave, estado: 'pendiente' })), { ignoreDuplicates: true });
        nuevos += faltan.length;
        desde = Number(leidos[leidos.length - 1].externoId);
        if (renglones.length < 5000) break;
      }
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      this.logger.error(`${lector.nombre}: ${detalle}`);
      await this.lecturas.create({ sistema: lector.clave, usuario, nuevos, error: detalle.slice(0, 500) });
      throw new BadRequestException(`No se pudo leer ${lector.nombre}. ${explicar(detalle)}`);
    } finally {
      await db.close().catch(() => undefined);
    }
    await this.lecturas.create({ sistema: lector.clave, usuario, nuevos, error: null });
    if (nuevos) await this.bitacora.registrar({ usuario, entidad: `externo:${lector.clave}`, accion: 'trae_movimientos', despues: { nuevos } });
    return { nuevos };
  }

  async listar(sistema: string, filtro: { estado?: string; tipo?: string; q?: string; desde?: number }) {
    const lector = this.lector(sistema);
    await this.liberar(lector.clave);
    const estado = filtro.estado === 'aplicado' || filtro.estado === 'descartado' ? filtro.estado : 'pendiente';
    const q = filtro.q?.trim();
    const where = {
      sistema: lector.clave,
      estado: estado === 'pendiente' ? ['pendiente', 'aplicando'] : estado,
      ...(q ? { [Op.or]: [{ curp: { [Op.iLike]: patron(q) } }, { rfc: { [Op.iLike]: patron(q) } }, contiene(Sequelize.col('nombre'), q)] } : {}),
    };
    const conteo = (await this.externos.findAll({ attributes: ['tipo', [Sequelize.fn('count', Sequelize.col('id')), 'total']], where, group: ['tipo'], raw: true })) as unknown as { tipo: string; total: string }[];
    const filas = await this.externos.findAll({
      where: { ...where, ...(filtro.tipo ? { tipo: filtro.tipo } : {}) },
      order: estado === 'pendiente' ? [['id', 'ASC']] : [['atendidoEl', 'DESC'], ['id', 'DESC']],
      limit: POR_PAGINA,
      offset: filtro.desde ?? 0,
    });
    const planes = estado === 'pendiente' ? await this.planes(filas) : [];
    return {
      total: conteo.filter((c) => !filtro.tipo || c.tipo === filtro.tipo).reduce((s, c) => s + Number(c.total), 0),
      porTipo: Object.fromEntries(conteo.map((c) => [c.tipo, Number(c.total)])),
      movimientos: filas.map((m, i) => ({
        id: m.id,
        tipo: m.tipo,
        tipoNombre: lector.tipos[m.tipo] ?? m.tipo,
        subtipo: m.subtipo,
        nombre: m.nombre,
        curp: m.curp,
        tipoNomina: m.tipoNomina,
        anio: m.anio,
        quincena: m.quincena,
        fecha: m.fecha,
        lote: m.lote,
        estado: m.estado,
        mensaje: m.mensaje,
        empleadoId: m.empleadoId ?? planes[i]?.empleadoId ?? null,
        efecto: planes[i]?.efecto ?? [],
        avisos: planes[i]?.avisos ?? [],
        problema: planes[i]?.problema ?? null,
        atendidoPor: m.atendidoPor,
        atendidoEl: m.atendidoEl,
        traidoEl: m.createdAt,
      })),
    };
  }

  /** Aplica uno por uno y en el orden en que llegaron; lo que no se puede, se queda con su motivo. */
  async aplicar(sistema: string, ids: number[], usuario: string) {
    const lector = this.lector(sistema);
    const filas = await this.externos.findAll({ where: { id: ids, sistema: lector.clave, estado: 'pendiente' }, order: [['id', 'ASC']] });
    const resultado = { aplicados: 0, errores: [] as { id: number; nombre: string; error: string }[] };
    for (const m of filas) {
      // Se aparta antes de aplicar: si dos personas lo aplican a la vez, solo una lo logra.
      const [apartado] = await this.externos.update({ estado: 'aplicando' }, { where: { id: m.id, estado: 'pendiente' } });
      if (!apartado) continue;
      try {
        const [plan] = await this.planes([m]);
        if (plan.problema) throw new ConflictException(plan.problema);
        let empleadoId = plan.empleadoId;
        for (const a of plan.acciones) empleadoId = await this.ejecutar(a, empleadoId, m, usuario);
        await this.externos.update(
          { estado: 'aplicado', mensaje: plan.efecto.join(' · '), empleadoId, atendidoPor: usuario, atendidoEl: new Date() },
          { where: { id: m.id } },
        );
        await this.bitacora.registrar({
          usuario, entidad: `externo:${lector.clave}`, entidadId: m.id, accion: 'aplica_movimiento',
          despues: { empleadoId, externo: m.externoId, tipo: lector.tipos[m.tipo] ?? m.tipo, efecto: plan.efecto },
        });
        resultado.aplicados++;
      } catch (e) {
        const error = mensajeDe(e);
        // Por id y no con m.update: en memoria `m` sigue como pendiente y no guardaría el cambio.
        await this.externos.update({ estado: 'pendiente', mensaje: error }, { where: { id: m.id } });
        resultado.errores.push({ id: m.id, nombre: m.nombre, error });
      }
    }
    return resultado;
  }

  async descartar(sistema: string, ids: number[], motivo: string, usuario: string) {
    const lector = this.lector(sistema);
    const [descartados] = await this.externos.update(
      { estado: 'descartado', mensaje: motivo, atendidoPor: usuario, atendidoEl: new Date() },
      { where: { id: ids, sistema: lector.clave, estado: 'pendiente' } },
    );
    await this.bitacora.registrar({ usuario, entidad: `externo:${lector.clave}`, accion: 'descarta_movimientos', despues: { ids, motivo, descartados } });
    return { descartados };
  }

  async restaurar(sistema: string, id: number, usuario: string) {
    const lector = this.lector(sistema);
    const [cambio] = await this.externos.update(
      { estado: 'pendiente', mensaje: null, atendidoPor: null, atendidoEl: null },
      { where: { id, sistema: lector.clave, estado: 'descartado' } },
    );
    if (!cambio) throw new NotFoundException('Ese movimiento no está descartado.');
    await this.bitacora.registrar({ usuario, entidad: `externo:${lector.clave}`, entidadId: id, accion: 'restaura_movimiento' });
  }

  // ---------------------------------------------------------------------------------------------

  /** Regresa a la bandeja lo que quedó apartado porque el servidor se detuvo. */
  private async liberar(sistema: Sistema) {
    await this.externos.update(
      { estado: 'pendiente', mensaje: 'Se interrumpió al aplicarse: revisa su ficha antes de aplicarlo otra vez.' },
      { where: { sistema, estado: 'aplicando', updatedAt: { [Op.lt]: new Date(Date.now() - APARTADO_MS) } } },
    );
  }

  private async ejecutar(a: Accion, empleadoId: number | null, m: MovimientoExterno, usuario: string): Promise<number | null> {
    const id = empleadoId!;
    const observaciones = `Otros sistemas: ${m.sistema} ${m.externoId}`;
    switch (a.hacer) {
      case 'alta':
        return (await this.empleadosSrv.crear(a.datos, usuario)).id;
      case 'reingreso':
        await this.movimientosSrv.reingreso(id, { fecha: a.fecha, observaciones }, usuario);
        return id;
      case 'baja':
        await this.movimientosSrv.baja(id, { fecha: a.fecha, motivoClave: a.motivo, observaciones }, usuario);
        return id;
      case 'permiso':
        await this.movimientosSrv.permiso(id, { inicio: a.inicio, fin: a.fin, motivoClave: a.motivo, observaciones }, usuario);
        return id;
      case 'cambio':
        await this.empleadosSrv.actualizar(id, a.campos, usuario);
        return id;
      case 'fija':
        await this.empleadosSrv.fijarConcepto(id, a.conceptoId, { importe: a.importe }, usuario);
        return id;
      case 'captura': {
        const empleado = await this.empleados.findByPk(id);
        const periodo = await this.periodos.actual(empleado!.tipoNomina);
        if (!periodo || periodo.estado === 'cerrado') throw new ConflictException('No hay quincena abierta en esa nómina.');
        await this.capturas.crear(periodo.id, { empleadoId: id, conceptoId: a.conceptoId, importe: a.importe, referencia: a.referencia }, usuario, m.sistema);
        return id;
      }
      case 'prestamo-nuevo': {
        const creado = await this.plazos.create({
          empleadoId: id, conceptoId: a.conceptoId, importeQuincenal: a.importe, porcentaje: null, quincenasPendientes: a.quincenas,
          beneficiario: a.beneficiario?.slice(0, 120) ?? null, activo: true, referenciaExterna: a.referencia,
        });
        await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'descuento_plazo', despues: { ...a, hacer: undefined, plazo: creado.id } });
        return id;
      }
      case 'prestamo-cambio': {
        const plazo = await this.plazos.findByPk(a.plazoId);
        if (!plazo) throw new ConflictException('El préstamo ya no existe en SIGenom.');
        const antes = { importeQuincenal: plazo.importeQuincenal, quincenasPendientes: plazo.quincenasPendientes, activo: plazo.activo };
        await plazo.update(a.campos);
        await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'descuento_plazo', antes: { plazo: plazo.id, ...antes }, despues: { plazo: plazo.id, ...a.campos } });
        return id;
      }
    }
  }

  /** Junta de una vez lo que hace falta para decidir sobre varios movimientos. */
  private async planes(filas: MovimientoExterno[]): Promise<Plan[]> {
    if (!filas.length) return [];
    const curps = [...new Set(filas.map((f) => f.curp).filter((x): x is string => !!x))];
    const rfcs = [...new Set(filas.map((f) => f.rfc).filter((x): x is string => !!x))];
    const [personas, conceptos, puestos, adscripciones] = await Promise.all([
      this.empleados.findAll({ where: { [Op.or]: [{ curp: curps }, { rfc: rfcs }] }, include: [EmpleadoConcepto] }),
      this.conceptos.findAll(),
      this.puestos.findAll({ where: { activo: true }, attributes: ['clave'] }),
      this.adscripciones.findAll({ where: { activo: true }, attributes: ['id'] }),
    ]);
    const prestamos = filas.filter((f) => f.sistema === 'prestamos').map((f) => String(f.datos.prestamo ?? '')).filter(Boolean);
    const plazos = prestamos.length ? await this.plazos.findAll({ where: { referenciaExterna: prestamos } }) : [];
    const periodos = new Map<string, Awaited<ReturnType<PeriodosService['actual']>>>();
    const tabuladores = new Map<string, Set<string>>();
    const conTxt = new Map<number, boolean>();
    const clavesPuesto = new Set(puestos.map((p) => p.clave));
    const idsAdscripcion = new Set(adscripciones.map((a) => a.id));

    const planes: Plan[] = [];
    for (const m of filas) {
      let candidatos = personas.filter((e) => (m.curp ? e.curp === m.curp : !!m.rfc && e.rfc === m.rfc));
      if (!candidatos.length && m.rfc) candidatos = personas.filter((e) => e.rfc === m.rfc);
      if (m.tipoNomina) candidatos = candidatos.filter((e) => e.tipoNomina === m.tipoNomina);
      if (candidatos.length > 1) {
        const vivos = candidatos.filter((e) => e.estado !== 'baja');
        if (vivos.length === 1) candidatos = vivos;
      }
      const e = candidatos.length === 1 ? candidatos[0] : null;
      const nomina = e?.tipoNomina ?? m.tipoNomina;
      if (nomina && !periodos.has(nomina)) {
        const p = await this.periodos.actual(nomina);
        periodos.set(nomina, p && p.estado !== 'cerrado' ? p : null);
      }
      const periodo = nomina ? (periodos.get(nomina) ?? null) : null;
      if (periodo && !tabuladores.has(periodo.fechaFin)) tabuladores.set(periodo.fechaFin, new Set((await this.tablas.tabuladorVigente(periodo.fechaFin)).keys()));
      if (periodo && !conTxt.has(periodo.id)) conTxt.set(periodo.id, (await this.capturasModelo.count({ where: { periodoId: periodo.id, origen: 'legado' } })) > 0);
      const plazo = plazos.find((p) => p.referenciaExterna === String(m.datos.prestamo ?? '') && p.empleadoId === e?.id) ?? null;
      const ctx: Contexto = {
        empleado: e
          ? {
              id: e.id, tipoNomina: e.tipoNomina, estado: e.estado, puestoClave: e.puestoClave, nivel: e.nivel, rango: e.rango, adscripcionId: e.adscripcionId,
              fijos: new Map(e.conceptosFijos.map((f) => [f.conceptoId, f.importe])),
            }
          : null,
        ambiguo: candidatos.length > 1,
        conTxt: !!periodo && !!conTxt.get(periodo.id),
        periodo,
        conceptos: new Map(conceptos.filter((c) => c.tipoNomina === nomina).map((c): [number, ConceptoPlan] => [c.clave, { id: c.id, clave: c.clave, descripcion: c.descripcion, naturaleza: c.naturaleza, calculado: c.calculado, activo: c.activo }])),
        puestos: clavesPuesto,
        adscripciones: idsAdscripcion,
        tabulador: (periodo && tabuladores.get(periodo.fechaFin)) || new Set(),
        plazo: plazo ? { id: plazo.id, conceptoId: plazo.conceptoId, importeQuincenal: plazo.importeQuincenal, quincenasPendientes: plazo.quincenasPendientes, activo: plazo.activo } : null,
      };
      planes.push(planear(m, ctx));
    }
    return planes;
  }

  private lector(sistema: string): Lector {
    const l = LECTORES.find((x) => x.clave === sistema);
    if (!l) throw new NotFoundException('Ese sistema no existe.');
    return l;
  }

  /** EXT_PERSONAL_HOST, EXT_CHECADOR_HOST, EXT_PRESTAMOS_HOST… Sin host o sin base, no está conectado. */
  private conexionDe(l: Lector) {
    const v = (campo: string) => process.env[`EXT_${l.clave.toUpperCase()}_${campo}`]?.trim() || undefined;
    const [host, database] = [v('HOST'), v('BASE')];
    if (!host || !database) return null;
    return { host, port: Number(v('PORT') ?? 5432), database, username: v('USUARIO'), password: v('PASSWORD') };
  }
}

function mensajeDe(e: unknown): string {
  if (e && typeof e === 'object' && 'getResponse' in e) {
    const r = (e as { getResponse: () => unknown }).getResponse();
    const m = r && typeof r === 'object' && 'message' in r ? (r as { message: unknown }).message : r;
    return Array.isArray(m) ? m.join(' ') : String(m);
  }
  return e instanceof Error ? e.message : String(e);
}

/** Qué decirle a la persona; el detalle técnico queda en el registro. */
function explicar(detalle: string): string {
  if (/does not exist/i.test(detalle) && /relation|column/i.test(detalle)) return 'La tabla de control no existe o no tiene las columnas esperadas.';
  if (/password|authentication|role .* does not exist/i.test(detalle)) return 'El usuario o la contraseña de la conexión no son correctos.';
  if (/permission denied/i.test(detalle)) return 'El usuario de la conexión no tiene permiso de leer esa tabla.';
  return 'No respondió el servidor; revisa la conexión.';
}
