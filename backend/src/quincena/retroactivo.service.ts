import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { TablasService } from '../common/tablas.service';
import { Concepto } from '../database/models/catalogos.models';
import { Captura, Periodo } from '../database/models/nomina.models';
import { PeriodosService } from './periodos.service';

/** Claves del tabulador, su campo y la clave de su retroactivo (clave + 100). */
const DEL_TABULADOR = [
  { calculado: 'sueldo', campo: 'sueldoMensual' },
  { calculado: 'compensacion', campo: 'compensacionMensual' },
  { calculado: 'gratificacion', campo: 'gratificacionMensual' },
] as const;

interface Pagado { empleado_id: number; nombre: string; periodo_id: number; fecha_fin: string; nivel: number; rango: number; calculado: string; importe: number }

/**
 * Retroactivo de un aumento (1CAL-A-S.W): el tabulador nuevo vale desde antes, pero las quincenas
 * pagadas no se rehacen. Por cada quincena desde la fecha del aumento se compara lo que se pagó de
 * sueldo, compensación y gratificación contra lo mismo con el tabulador de la quincena abierta, en
 * proporción a lo pagado (quien cobró media quincena recibe media diferencia). La suma se captura en
 * las claves 101, 111 y 112 de la quincena abierta.
 */
@Injectable()
export class RetroactivoService {
  constructor(
    private readonly periodos: PeriodosService,
    private readonly tablas: TablasService,
    private readonly bitacora: BitacoraService,
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
    @InjectModel(Captura) private readonly capturas: typeof Captura,
  ) {}

  async vista(periodoId: number, desde: string) {
    const { filas, quincenas, sinNivel, yaRetro } = await this.calcular(await this.periodos.abierto(periodoId), desde);
    const total = filas.reduce((s, f) => s + f.centavos, 0);
    const porClave = new Map<number, { clave: number; descripcion: string; empleados: number; centavos: number }>();
    for (const f of filas) {
      const r = porClave.get(f.concepto.clave) ?? { clave: f.concepto.clave, descripcion: f.concepto.descripcion, empleados: 0, centavos: 0 };
      r.empleados++;
      r.centavos += f.centavos;
      porClave.set(f.concepto.clave, r);
    }
    const porEmpleado = new Map<number, { empleadoId: number; nombre: string; quincenas: number; centavos: number }>();
    for (const f of filas) {
      const r = porEmpleado.get(f.empleadoId) ?? { empleadoId: f.empleadoId, nombre: f.nombre, quincenas: f.quincenas, centavos: 0 };
      r.centavos += f.centavos;
      r.quincenas = Math.max(r.quincenas, f.quincenas);
      porEmpleado.set(f.empleadoId, r);
    }
    return {
      desde,
      quincenas,
      empleados: porEmpleado.size,
      total: total / 100,
      sinNivel,
      yaRetro,
      claves: [...porClave.values()].sort((a, b) => a.clave - b.clave).map(({ centavos, ...r }) => ({ ...r, total: centavos / 100 })),
      muestra: [...porEmpleado.values()].sort((a, b) => b.centavos - a.centavos).slice(0, 20).map(({ centavos, ...r }) => ({ ...r, total: centavos / 100 })),
    };
  }

  /** Sustituye el retroactivo calculado antes en esta quincena; lo capturado a mano no se toca. */
  async aplicar(periodoId: number, desde: string, usuario: string) {
    const periodo = await this.periodos.abierto(periodoId);
    const { filas, quincenas } = await this.calcular(periodo, desde);
    await this.capturas.sequelize!.transaction(async (transaction) => {
      const borradas = await this.capturas.destroy({ where: { periodoId, origen: 'retroactivo' }, transaction });
      await this.capturas.bulkCreate(
        filas.map((f) => ({
          periodoId,
          empleadoId: f.empleadoId,
          conceptoId: f.concepto.id,
          importe: f.centavos / 100,
          origen: 'retroactivo',
          referencia: `Aumento desde ${desde}: ${f.quincenas} quincenas`.slice(0, 80),
          registradoPor: usuario,
        })),
        { transaction },
      );
      await this.bitacora.registrar(
        { usuario, entidad: 'periodo', entidadId: periodoId, accion: 'retroactivo', despues: { desde, quincenas, capturas: filas.length, borradas } },
        transaction,
      );
    });
    return this.vista(periodoId, desde);
  }

  private async calcular(periodo: Periodo, desde: string) {
    if (desde >= periodo.fechaInicio) throw new BadRequestException('La fecha del aumento debe ser anterior a esta quincena.');
    const conceptos = await this.conceptos.findAll({ where: { tipoNomina: periodo.tipoNomina } });
    const porClave = new Map(conceptos.map((c) => [c.clave, c]));
    const retroDe = new Map<string, Concepto>();
    for (const { calculado } of DEL_TABULADOR) {
      const normal = conceptos.find((c) => c.calculado === calculado);
      const retro = normal && porClave.get(normal.clave + 100);
      if (retro) retroDe.set(calculado, retro);
    }
    if (!retroDe.size) throw new BadRequestException('No hay claves de retroactivo (101, 111, 112) en el catálogo.');

    const db = this.capturas.sequelize!;
    const replacements = { tipo: periodo.tipoNomina, desde, inicio: periodo.fechaInicio, periodo: periodo.id, retro: [...retroDe.values()].map((c) => c.id) };
    // De cada quincena, lo pagado: la nómina de SIGenom o, si no se calculó aquí, la del sistema anterior.
    const pagado = await db.query<Pagado>(
      `WITH pagados AS (
         SELECT DISTINCT ON (p.id) p.id periodo_id, p.fecha_fin, c.id calculo_id FROM periodos p JOIN calculos c ON c.periodo_id = p.id
         WHERE p.tipo_nomina = :tipo AND p.fecha_inicio >= :desde AND p.fecha_fin < :inicio AND c.estado = 'terminado'
           AND (c.tipo = 'nomina' OR (c.tipo = 'legado' AND c.error IS NULL))
         ORDER BY p.id, (c.tipo = 'nomina') DESC, c.id DESC)
       SELECT r.empleado_id, r.nombre, x.periodo_id, x.fecha_fin::text, r.nivel, r.rango, k.calculado, rc.importe::float importe
       FROM pagados x JOIN recibos r ON r.calculo_id = x.calculo_id JOIN recibo_conceptos rc ON rc.recibo_id = r.id
       JOIN conceptos k ON k.id = rc.concepto_id JOIN empleados e ON e.id = r.empleado_id
       WHERE k.calculado IN ('sueldo', 'compensacion', 'gratificacion')
         AND (e.fecha_baja IS NULL OR e.fecha_baja >= :inicio)`,
      { type: QueryTypes.SELECT, replacements },
    );
    // Quien ya tiene capturado ese retroactivo por otro lado se deja como está: no se le paga dos veces.
    const yaCapturado = new Set(
      (await db.query<{ llave: string }>(
        `SELECT DISTINCT empleado_id || '|' || concepto_id llave FROM capturas WHERE periodo_id = :periodo AND concepto_id IN (:retro) AND origen <> 'retroactivo'`,
        { type: QueryTypes.SELECT, replacements },
      )).map((x) => x.llave),
    );
    const omitidos = new Set<number>();

    const nuevo = await this.tablas.tabuladorVigente(periodo.fechaFin);
    const viejos = new Map<string, Awaited<ReturnType<TablasService['tabuladorVigente']>>>();
    const acumulado = new Map<string, { empleadoId: number; nombre: string; concepto: Concepto; centavos: number; periodos: Set<number> }>();
    const sinNivel = new Set<number>();
    for (const f of pagado) {
      const retro = retroDe.get(f.calculado);
      if (!retro) continue;
      if (!viejos.has(f.fecha_fin)) viejos.set(f.fecha_fin, await this.tablas.tabuladorVigente(f.fecha_fin));
      const campo = DEL_TABULADOR.find((d) => d.calculado === f.calculado)!.campo;
      const antes = viejos.get(f.fecha_fin)!.get(`${f.nivel}-${f.rango}`)?.[campo] ?? 0;
      const despues = nuevo.get(`${f.nivel}-${f.rango}`)?.[campo] ?? 0;
      if (f.nivel === 0 || !antes || !despues) {
        if (f.calculado === 'sueldo') sinNivel.add(f.empleado_id);
        continue;
      }
      // Proporcional a lo pagado; quincena completa (antes / 2) da la diferencia exacta.
      const diferencia = Math.round(((Math.round(despues * 100) - Math.round(antes * 100)) / 2) * Math.min(1, f.importe / (antes / 2)));
      const llave = `${f.empleado_id}|${retro.id}`;
      if (yaCapturado.has(llave)) {
        omitidos.add(f.empleado_id);
        continue;
      }
      const a = acumulado.get(llave) ?? { empleadoId: f.empleado_id, nombre: f.nombre, concepto: retro, centavos: 0, periodos: new Set<number>() };
      a.centavos += diferencia;
      a.periodos.add(f.periodo_id);
      acumulado.set(llave, a);
    }
    return {
      filas: [...acumulado.values()].filter((a) => a.centavos > 0).map(({ periodos, ...a }) => ({ ...a, quincenas: periodos.size })),
      quincenas: new Set(pagado.map((f) => f.periodo_id)).size,
      sinNivel: sinNivel.size,
      yaRetro: omitidos.size,
    };
  }
}
