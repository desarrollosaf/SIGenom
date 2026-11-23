import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { type ContextoCalculo, EntradaService } from '../common/entrada.service';
import { Concepto } from '../database/models/catalogos.models';
import { Captura } from '../database/models/nomina.models';
import { DescuentoPlazo, Empleado, EmpleadoConcepto } from '../database/models/personal.models';
import { calcularRecibo } from '../motor/motor';
import type { EmpleadoMotor } from '../motor/tipos';
import { PeriodosService } from './periodos.service';

/** Gratificación extraordinaria: la que se sube por omisión para compensar un neto negativo. */
const CLAVE_SUGERIDA = 17;
/** Tope de la búsqueda: un ajuste mayor que esto no es un ajuste. */
const MAXIMO_CENTAVOS = 100_000_000;

/**
 * Corrige a una persona cuyo neto sale negativo o en cero, sin salir de Verificación. Antes se hacía
 * a mano, subiendo unos centavos hasta que el neto quedara en $0.01. Aquí el importe lo busca el
 * mismo motor de la nómina, porque una percepción que grava también sube el ISR y las cuotas.
 * El ajuste se guarda como captura de la quincena y vale desde el siguiente cálculo.
 */
@Injectable()
export class AjusteNetoService {
  constructor(
    private readonly periodos: PeriodosService,
    private readonly entrada: EntradaService,
    private readonly bitacora: BitacoraService,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
    @InjectModel(Captura) private readonly capturas: typeof Captura,
  ) {}

  /** Cómo está su recibo con lo capturado hasta ahora y qué claves se pueden mover. */
  async ver(periodoId: number, empleadoId: number) {
    const { periodo, ctx, entrada, empleado } = await this.cargar(periodoId, empleadoId);
    const actual = calcularRecibo(entrada, ctx.tablas);
    const conceptos = [...ctx.tablas.conceptos.values()];
    const catalogo = await this.conceptos.findAll({ where: { tipoNomina: periodo.tipoNomina, activo: true }, attributes: ['id'] });
    const activos = new Set(catalogo.map((c) => c.id));
    const capturados = await this.capturas.findAll({ where: { periodoId, empleadoId, origen: 'ajuste_neto' }, order: [['id', 'ASC']] });
    const opcion = (c: { id: number; clave: number; descripcion: string; gravaIsr: boolean }, importe: number) => ({
      conceptoId: c.id, clave: c.clave, descripcion: c.descripcion, gravaIsr: c.gravaIsr, importe,
    });
    const importeDe = (id: number) => actual.lineas.find((l) => l.conceptoId === id)?.importe ?? 0;

    return {
      empleadoId,
      nombre: empleado.nombreCompleto,
      recibo: actual,
      // Percepciones normales (no retroactivos ni las que calcula el sistema); la 017 primero.
      percepciones: conceptos
        .filter((c) => c.naturaleza === 'P' && !c.calculado && c.clave > 0 && c.clave <= 100 && activos.has(c.id))
        .sort((a, b) => Number(b.clave === CLAVE_SUGERIDA) - Number(a.clave === CLAVE_SUGERIDA) || a.clave - b.clave)
        .map((c) => opcion(c, importeDe(c.id))),
      // Deducciones que sí tiene y no calcula el sistema: se pueden bajar.
      deducciones: actual.lineas
        .filter((l) => l.naturaleza === 'D' && !ctx.tablas.conceptos.get(l.conceptoId)?.calculado)
        .map((l) => opcion(ctx.tablas.conceptos.get(l.conceptoId)!, l.importe)),
      ajustes: capturados.map((c) => ({
        id: c.id,
        clave: ctx.tablas.conceptos.get(c.conceptoId)?.clave ?? 0,
        descripcion: ctx.tablas.conceptos.get(c.conceptoId)?.descripcion ?? '',
        importe: c.importe,
        referencia: c.referencia,
        registradoPor: c.registradoPor,
      })),
    };
  }

  /** Cómo queda el recibo con ese importe; sin importe, busca el mínimo que deja el neto objetivo. */
  async probar(periodoId: number, datos: { empleadoId: number; conceptoId: number; importe?: number; objetivo?: number }) {
    const { ctx, entrada } = await this.cargar(periodoId, datos.empleadoId);
    const { signo, maximo } = this.direccion(ctx, entrada, datos.conceptoId);
    const con = (centavos: number) =>
      calcularRecibo({ ...entrada, capturas: [...entrada.capturas, { conceptoId: datos.conceptoId, importe: (signo * centavos) / 100 }] }, ctx.tablas);

    let centavos: number;
    if (datos.importe !== undefined) {
      centavos = Math.round(datos.importe * 100);
      if (centavos <= 0 || centavos > maximo) throw new BadRequestException(this.fueraDeRango(signo, maximo));
    } else {
      const objetivo = Math.round((datos.objetivo ?? 0.01) * 100);
      const encontrado = buscarImporte((c) => Math.round(con(c).neto * 100), objetivo, maximo);
      if (encontrado === null) {
        throw new BadRequestException(
          signo < 0 ? 'Ni quitando toda esa deducción se llega a ese neto. Elige otra o sube una percepción.' : 'No se encontró un importe que llegue a ese neto.',
        );
      }
      centavos = encontrado;
    }
    return { importe: centavos / 100, recibo: con(centavos) };
  }

  /** Cómo cambia el recibo con un movimiento (captura o clave fija) y sus marcas, sin guardarlo. */
  async impacto(
    periodoId: number,
    datos: { empleadoId: number; conceptoId: number; importe: number; gravaIsr?: boolean | null; timbra?: boolean | null; fija?: boolean },
  ) {
    const { ctx, entrada } = await this.cargar(periodoId, datos.empleadoId);
    const concepto = ctx.tablas.conceptos.get(datos.conceptoId);
    if (!concepto) throw new BadRequestException('Esa clave no es de esta nómina.');
    const { conceptoId, importe, gravaIsr, timbra } = datos;
    const movimiento = { conceptoId, importe, gravaIsr, timbra };
    const despues = datos.fija
      ? { ...entrada, fijos: [...entrada.fijos.filter((f) => f.conceptoId !== conceptoId), movimiento] }
      : { ...entrada, capturas: [...entrada.capturas, movimiento] };
    const resumen = (e: EmpleadoMotor) => {
      const r = calcularRecibo(e, ctx.tablas);
      const de = (...cuales: string[]) =>
        Math.round(r.lineas.filter((l) => cuales.includes(ctx.tablas.conceptos.get(l.conceptoId)?.calculado ?? '')).reduce((s, l) => s + l.importe * 100, 0)) / 100;
      return {
        baseIsr: r.baseIsr,
        isr: de('isr'),
        issemym: de('issemym_salud', 'issemym_pension', 'issemym_salud_retro', 'issemym_pens_retro', 'sci', 'sci_retro'),
        neto: r.neto,
      };
    };
    return { antes: resumen(entrada), despues: resumen(despues) };
  }

  async aplicar(periodoId: number, datos: { empleadoId: number; conceptoId: number; importe: number; motivo?: string }, usuario: string) {
    const { importe, recibo } = await this.probar(periodoId, datos);
    const { ctx, entrada } = await this.cargar(periodoId, datos.empleadoId);
    const { signo } = this.direccion(ctx, entrada, datos.conceptoId);
    const captura = await this.capturas.create({
      periodoId,
      empleadoId: datos.empleadoId,
      conceptoId: datos.conceptoId,
      importe: signo * importe,
      origen: 'ajuste_neto',
      referencia: (datos.motivo?.trim() || 'Ajuste de neto').slice(0, 80),
      registradoPor: usuario,
    });
    await this.bitacora.registrar({
      usuario,
      entidad: 'captura',
      entidadId: captura.id,
      accion: 'ajuste_neto',
      antes: { neto: calcularRecibo(entrada, ctx.tablas).neto },
      despues: { periodoId, ...datos, importe: signo * importe, neto: recibo.neto },
    });
    return this.ver(periodoId, datos.empleadoId);
  }

  private direccion(ctx: ContextoCalculo, entrada: EmpleadoMotor, conceptoId: number) {
    const concepto = ctx.tablas.conceptos.get(conceptoId);
    if (!concepto) throw new BadRequestException('Esa clave no es de esta nómina.');
    if (concepto.calculado) throw new BadRequestException(`${concepto.descripcion} lo calcula el sistema.`);
    if (concepto.naturaleza === 'P') return { signo: 1, maximo: MAXIMO_CENTAVOS };
    const tiene = calcularRecibo(entrada, ctx.tablas).lineas.find((l) => l.conceptoId === conceptoId)?.importe ?? 0;
    if (tiene <= 0) throw new BadRequestException(`No tiene ${concepto.descripcion} en esta quincena.`);
    return { signo: -1, maximo: Math.round(tiene * 100) };
  }

  private fueraDeRango(signo: number, maximo: number) {
    return signo < 0 ? `El importe va de 0.01 a ${(maximo / 100).toFixed(2)}, que es lo que tiene de esa deducción.` : 'Importe no válido.';
  }

  private async cargar(periodoId: number, empleadoId: number) {
    const periodo = await this.periodos.abierto(periodoId);
    const empleado = await this.empleados.findByPk(empleadoId, {
      include: [{ model: EmpleadoConcepto }, { model: DescuentoPlazo, where: { activo: true }, required: false }],
    });
    if (!empleado || empleado.tipoNomina !== periodo.tipoNomina) throw new NotFoundException('El empleado no pertenece a esta nómina.');
    const ctx = await this.entrada.contexto(periodo, 'quincenal');
    const [{ entrada }] = await this.entrada.entradas(ctx, [empleado]);
    return { periodo, empleado, ctx, entrada };
  }
}

/**
 * El menor importe (centavos) cuyo neto alcanza el objetivo. El neto sube con el importe, pero el
 * redondeo del ISR lo hace subir y bajar un par de centavos: se acota por mitades y se afina al final.
 */
export function buscarImporte(neto: (centavos: number) => number, objetivo: number, maximo: number): number | null {
  if (neto(maximo) < objetivo) return null;
  let abajo = 0;
  let arriba = maximo;
  while (arriba - abajo > 1) {
    const medio = Math.floor((abajo + arriba) / 2);
    if (neto(medio) >= objetivo) arriba = medio;
    else abajo = medio;
  }
  for (let c = Math.max(1, arriba - 20); c < arriba; c++) if (neto(c) >= objetivo) return c;
  return arriba;
}
