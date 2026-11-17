export type Naturaleza = 'P' | 'D';

/**
 * Conceptos que el motor genera por su cuenta. El resto (despensa, préstamos, cuotas sindicales…)
 * llega como fijo del empleado, captura de la quincena o descuento a plazo.
 */
export type ConceptoCalculado =
  | 'sueldo'
  | 'compensacion'
  | 'isr'
  | 'issemym_salud'
  | 'issemym_pension'
  | 'aguinaldo'
  | 'prima_vacacional';

export interface ConceptoMotor {
  id: number;
  clave: number;
  descripcion: string;
  naturaleza: Naturaleza;
  gravaIsr: boolean;
  /** Porción del importe que integra la base ISSEMYM (0 a 1). */
  factorIssemym: number;
  partida: string | null;
  calculado: ConceptoCalculado | null;
}

export interface FilaIsr {
  limiteInferior: number;
  cuotaFija: number;
  /** Porcentaje sobre el excedente, en por ciento (10.88, no 0.1088). */
  porcentaje: number;
}

export interface FilaSubsidio {
  ingresoDesde: number;
  subsidio: number;
}

export interface ParametrosMotor {
  /** Días que paga una quincena completa. */
  diasQuincena: number;
  /** Cuotas del trabajador al ISSEMYM, en tasa (0.04625 = 4.625 %). */
  tasaIssemymSalud: number;
  tasaIssemymPension: number;
  /** Tope de la base de cotización quincenal ISSEMYM; 0 sin tope. */
  topeIssemym: number;
  diasAguinaldo: number;
  diasPrimaVacacional: number;
  porcentajePrimaVacacional: number;
  /** UMA diaria, para las partes exentas de aguinaldo (30 UMA) y prima vacacional (15 UMA). */
  umaDiaria: number;
}

export interface TablasMotor {
  isr: FilaIsr[];
  subsidio: FilaSubsidio[];
  parametros: ParametrosMotor;
  conceptos: Map<number, ConceptoMotor>;
  /** El concepto de cada cálculo automático para este tipo de nómina. */
  calculados: Partial<Record<ConceptoCalculado, ConceptoMotor>>;
}

export interface ImporteConcepto {
  conceptoId: number;
  importe: number;
}

export interface DescuentoPlazoMotor {
  conceptoId: number;
  importeQuincenal: number;
  /** Si tiene valor, se descuenta este porcentaje del neto antes del descuento (pensión alimenticia). */
  porcentaje: number | null;
}

export interface EmpleadoMotor {
  empleadoId: number;
  sueldoMensual: number;
  compensacionMensual: number;
  /** Días a pagar en la quincena; menos de 15 si hubo alta, baja o permiso a media quincena. */
  dias: number;
  fijos: ImporteConcepto[];
  capturas: ImporteConcepto[];
  descuentosPlazo: DescuentoPlazoMotor[];
  /** Para aguinaldo y prima: parte del año trabajada (0 a 1). */
  proporcionAnual?: number;
}

export interface LineaRecibo {
  conceptoId: number;
  clave: number;
  descripcion: string;
  naturaleza: Naturaleza;
  importe: number;
  gravadoIsr: number;
  partida: string | null;
}

export interface ResultadoRecibo {
  lineas: LineaRecibo[];
  dias: number;
  baseIsr: number;
  baseIssemym: number;
  isrCausado: number;
  subsidio: number;
  totalPercepciones: number;
  totalDeducciones: number;
  neto: number;
  observaciones: string[];
}
