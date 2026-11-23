import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import {
  Concepto,
  Parametro,
  TablaIsr,
  TablaSubsidio,
  Tabulador,
} from '../database/models/catalogos.models';
import { PeriodoConcepto } from '../database/models/nomina.models';
import { ordenarSubsidio, ordenarTarifa } from '../motor/isr';
import type {
  ConceptoCalculado,
  ConceptoMotor,
  ParametrosMotor,
  TablasMotor,
} from '../motor/tipos';

/** Parámetros con su valor por omisión; el seed los crea y se editan en Catálogos > Parámetros. */
export const PARAMETROS: Record<keyof Required<ParametrosMotor>, [string, string]> = {
  diasQuincena: ['15', 'Días que paga una quincena completa.'],
  tasaIssemymSalud: ['0.04625', 'Cuota del trabajador al ISSEMYM por servicios de salud (tasa).'],
  tasaIssemymPension: ['0.061', 'Cuota del trabajador al ISSEMYM al sistema de pensiones (tasa).'],
  topeIssemym: ['0', 'Tope quincenal de la base de cotización ISSEMYM; 0 sin tope.'],
  diasAguinaldo: ['40', 'Días de sueldo que se pagan de aguinaldo.'],
  diasPrimaVacacional: ['10', 'Días de vacaciones por periodo, base de la prima vacacional.'],
  porcentajePrimaVacacional: ['25', 'Porcentaje de prima vacacional.'],
  umaDiaria: ['113.14', 'Valor diario de la UMA vigente.'],
  isrMensual: ['0', 'ISR con tarifa mensual: 1 sí, 0 tarifa quincenal.'],
  isrAjusteMensual: ['0', 'En la 2a quincena, ISR del mes menos lo retenido en la 1a: 1 sí, 0 no.'],
  redondeoIsr: ['1', 'Redondeo del ISR en centavos: 5 o 1.'],
  isrMinimo: ['0', 'ISR mínimo cuando el subsidio lo deja en cero.'],
  tasaSci: ['0.014', 'Cuota obligatoria del Sistema de Capitalización Individual (tasa).'],
};

/** Carga, una sola vez por cálculo, todo lo que el motor necesita para un tipo de nómina. */
@Injectable()
export class TablasService {
  constructor(
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
    @InjectModel(TablaIsr) private readonly isr: typeof TablaIsr,
    @InjectModel(TablaSubsidio) private readonly subsidio: typeof TablaSubsidio,
    @InjectModel(Parametro) private readonly parametros: typeof Parametro,
    @InjectModel(Tabulador) private readonly tabulador: typeof Tabulador,
    @InjectModel(PeriodoConcepto) private readonly ajustes: typeof PeriodoConcepto,
  ) {}

  /**
   * El tabulador vigente a una fecha, por "nivel-rango": de cada nivel y rango, el renglón con la
   * vigencia más reciente que no sea posterior a la fecha.
   */
  async tabuladorVigente(fecha: string): Promise<Map<string, Tabulador>> {
    const filas = await this.tabulador.findAll({
      where: { vigencia: { [Op.lte]: fecha } },
      order: [['vigencia', 'ASC']],
    });
    return new Map(filas.map((t) => [`${t.nivel}-${t.rango}`, t]));
  }

  /**
   * Aplica a las tablas de un cálculo los ajustes de la quincena (una clave que esa quincena no
   * grava o no se timbra). Devuelve una descripción de cada ajuste para las observaciones.
   */
  async aplicarAjustes(tablas: TablasMotor, periodoId: number): Promise<string[]> {
    const ajustes = await this.ajustes.findAll({ where: { periodoId } });
    const avisos: string[] = [];
    for (const a of ajustes) {
      const c = tablas.conceptos.get(a.conceptoId);
      if (!c) continue;
      // Se cambia el mismo objeto, así también lo ve `calculados` si es un concepto del motor.
      if (a.gravaIsr !== null) c.gravaIsr = a.gravaIsr;
      if (a.timbra !== null) c.timbra = a.timbra;
      avisos.push(`${String(c.clave).padStart(3, '0')} ${c.gravaIsr ? 'grava' : 'no grava'} y ${c.timbra ? 'se timbra' : 'no se timbra'}`);
    }
    return avisos;
  }

  /** @param forzar 'Q' para pagos que no son la quincena (aguinaldo, prima): van con la tarifa quincenal. */
  async paraNomina(tipoNomina: string, fecha: string, forzar?: 'Q'): Promise<TablasMotor> {
    const parametros = await this.valoresParametros(fecha);
    if (forzar === 'Q') parametros.isrMensual = 0;
    const periodicidad = parametros.isrMensual ? 'M' : 'Q';
    const [conceptos, isr, subsidio] = await Promise.all([
      this.conceptos.findAll({ where: { tipoNomina } }),
      this.vigenciaDe(this.isr, fecha, periodicidad).then((v) => (v ? this.isr.findAll({ where: { vigencia: v, periodicidad } }) : [])),
      this.vigenciaDe(this.subsidio, fecha, periodicidad).then((v) => (v ? this.subsidio.findAll({ where: { vigencia: v, periodicidad } }) : [])),
    ]);
    if (isr.length === 0) {
      throw new BadRequestException(`No hay tarifa de ISR ${periodicidad === 'M' ? 'mensual' : 'quincenal'} vigente al ${fecha}.`);
    }

    const mapa = new Map<number, ConceptoMotor>();
    const calculados: Partial<Record<ConceptoCalculado, ConceptoMotor>> = {};
    for (const c of conceptos) {
      const motor: ConceptoMotor = {
        id: c.id,
        clave: c.clave,
        descripcion: c.descripcion,
        naturaleza: c.naturaleza,
        gravaIsr: c.gravaIsr,
        factorIssemym: c.factorIssemym,
        partida: c.partida,
        calculado: (c.calculado as ConceptoCalculado) ?? null,
        timbra: c.timbra ?? true,
      };
      mapa.set(c.id, motor);
      if (motor.calculado) calculados[motor.calculado] = motor;
    }

    return {
      isr: ordenarTarifa(isr),
      subsidio: ordenarSubsidio(subsidio),
      parametros,
      conceptos: mapa,
      calculados,
    };
  }

  async valoresParametros(fecha: string): Promise<ParametrosMotor> {
    // Por vigencia ascendente: de cada parámetro queda el más reciente que no pasa de la fecha.
    const filas = await this.parametros.findAll({ where: { vigencia: { [Op.lte]: fecha } }, order: [['vigencia', 'ASC']] });
    const leidos = new Map(filas.map((f) => [f.clave, f.valor]));
    const resultado = {} as ParametrosMotor;
    for (const [clave, [omision]] of Object.entries(PARAMETROS)) {
      const valor = Number(leidos.get(clave) ?? omision);
      resultado[clave as keyof ParametrosMotor] = Number.isFinite(valor) ? valor : Number(omision);
    }
    return resultado;
  }

  /** La vigencia más reciente de la tabla que no sea posterior a la fecha. */
  private async vigenciaDe(modelo: typeof TablaIsr | typeof TablaSubsidio, fecha: string, periodicidad: 'M' | 'Q') {
    const ultima: unknown = await (modelo as typeof TablaIsr).max('vigencia', {
      where: { vigencia: { [Op.lte]: fecha }, periodicidad },
    });
    return (ultima as string | null) ?? null;
  }
}
