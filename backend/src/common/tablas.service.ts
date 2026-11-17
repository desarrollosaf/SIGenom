import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import {
  Concepto,
  Parametro,
  TablaIsr,
  TablaSubsidio,
} from '../database/models/catalogos.models';
import { ordenarSubsidio, ordenarTarifa } from '../motor/isr';
import type {
  ConceptoCalculado,
  ConceptoMotor,
  ParametrosMotor,
  TablasMotor,
} from '../motor/tipos';

/** Parámetros con su valor por omisión; el seed los crea y se editan en Catálogos > Parámetros. */
export const PARAMETROS: Record<keyof ParametrosMotor, [string, string]> = {
  diasQuincena: ['15', 'Días que paga una quincena completa.'],
  tasaIssemymSalud: ['0.04625', 'Cuota del trabajador al ISSEMYM por servicios de salud (tasa).'],
  tasaIssemymPension: ['0.061', 'Cuota del trabajador al ISSEMYM al sistema de pensiones (tasa).'],
  topeIssemym: ['0', 'Tope quincenal de la base de cotización ISSEMYM; 0 sin tope.'],
  diasAguinaldo: ['40', 'Días de sueldo que se pagan de aguinaldo.'],
  diasPrimaVacacional: ['10', 'Días de vacaciones por periodo, base de la prima vacacional.'],
  porcentajePrimaVacacional: ['25', 'Porcentaje de prima vacacional.'],
  umaDiaria: ['113.14', 'Valor diario de la UMA vigente.'],
};

/** Carga, una sola vez por cálculo, todo lo que el motor necesita para un tipo de nómina. */
@Injectable()
export class TablasService {
  constructor(
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
    @InjectModel(TablaIsr) private readonly isr: typeof TablaIsr,
    @InjectModel(TablaSubsidio) private readonly subsidio: typeof TablaSubsidio,
    @InjectModel(Parametro) private readonly parametros: typeof Parametro,
  ) {}

  async paraNomina(tipoNomina: string, fecha: string): Promise<TablasMotor> {
    const [conceptos, isr, subsidio, parametros] = await Promise.all([
      this.conceptos.findAll({ where: { tipoNomina } }),
      this.vigenciaDe(this.isr, fecha).then((v) => (v ? this.isr.findAll({ where: { vigencia: v } }) : [])),
      this.vigenciaDe(this.subsidio, fecha).then((v) => (v ? this.subsidio.findAll({ where: { vigencia: v } }) : [])),
      this.valoresParametros(),
    ]);
    if (isr.length === 0) {
      throw new BadRequestException(`No hay tarifa de ISR vigente al ${fecha}.`);
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

  async valoresParametros(): Promise<ParametrosMotor> {
    const filas = await this.parametros.findAll();
    const leidos = new Map(filas.map((f) => [f.clave, f.valor]));
    const resultado = {} as ParametrosMotor;
    for (const [clave, [omision]] of Object.entries(PARAMETROS)) {
      const valor = Number(leidos.get(clave) ?? omision);
      resultado[clave as keyof ParametrosMotor] = Number.isFinite(valor) ? valor : Number(omision);
    }
    return resultado;
  }

  /** La vigencia más reciente de la tabla que no sea posterior a la fecha. */
  private async vigenciaDe(modelo: typeof TablaIsr | typeof TablaSubsidio, fecha: string) {
    const ultima: unknown = await (modelo as typeof TablaIsr).max('vigencia', {
      where: { vigencia: { [Op.lte]: fecha } },
    });
    return (ultima as string | null) ?? null;
  }
}
