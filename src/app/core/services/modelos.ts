/** Tipos de lo que regresa la API. */

export type EstadoEmpleado = 'activo' | 'permiso' | 'baja';
export type EstadoPeriodo = 'captura' | 'prenomina' | 'nomina' | 'cerrado';
/** `legado`: recibos tal como los pagó el sistema anterior (importar:txt-legado); no se recalcula. */
export type TipoCalculo = 'prenomina' | 'nomina' | 'aguinaldo' | 'prima_vacacional' | 'legado';
export type EstadoCalculo = 'en_cola' | 'procesando' | 'terminado' | 'error' | 'reemplazado';

export interface TipoNomina {
  clave: string;
  nombre: string;
}

export interface Opciones {
  tiposNomina: TipoNomina[];
  adscripciones: { id: number; nombre: string }[];
  puestos: { clave: string; nombre: string }[];
  motivos: { clave: string; nombre: string; aplica: 'B' | 'P' }[];
  conceptos: ConceptoOpcion[];
}

export interface ConceptoOpcion {
  id: number;
  tipoNomina: string;
  clave: number;
  nombre: string;
  naturaleza: 'P' | 'D';
  periodicidad: 'F' | 'E';
  calculado: string | null;
  gravaIsr: boolean;
  timbra: boolean;
  cotizaIssemym: boolean;
}

/** El recibo de una persona antes y después de un movimiento que todavía no se guarda. */
export interface ImpactoMovimiento {
  antes: { baseIsr: number; isr: number; issemym: number; neto: number };
  despues: { baseIsr: number; isr: number; issemym: number; neto: number };
}

/** Una clave que en una quincena grava o se timbra distinto del catálogo (null = como el catálogo). */
export interface AjusteQuincena {
  conceptoId: number;
  clave: number;
  descripcion: string;
  naturaleza: 'P' | 'D';
  catalogo: { gravaIsr: boolean; timbra: boolean };
  gravaIsr: boolean | null;
  timbra: boolean | null;
  motivo: string | null;
  registradoPor: string;
  actualizadoEl: string;
}

export interface Periodo {
  id: number;
  tipoNomina: string;
  anio: number;
  quincena: number;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  fechaPago: string | null;
  estado: EstadoPeriodo;
  cerradoPor: string | null;
  cerradoEl: string | null;
}

export interface Calculo {
  id: number;
  periodoId: number;
  tipo: TipoCalculo;
  estado: EstadoCalculo;
  totalEmpleados: number;
  procesados: number;
  totalPercepciones: number;
  totalDeducciones: number;
  totalNeto: number;
  error: string | null;
  solicitadoPor: string;
  iniciadoEl: string | null;
  terminadoEl: string | null;
  creadoEl: string;
}

export interface PeriodoDetalle extends Periodo {
  capturas: number;
  calculos: Calculo[];
}

export interface EmpleadoResumen {
  id: number;
  curp: string;
  rfc: string;
  nombre: string;
  apellidoPaterno: string;
  apellidoMaterno: string | null;
  nombres: string;
  tipoNomina: string;
  adscripcionId: number;
  adscripcion: string | null;
  puestoClave: string;
  puesto: string | null;
  nivel: number;
  rango: number;
  numeroIssemym: number | null;
  sindicalizado: boolean;
  sci: boolean;
  estado: EstadoEmpleado;
  fechaAlta: string;
  fechaBaja: string | null;
  fechaIngresoGobierno: string | null;
  fechaNacimiento: string | null;
  codigoPostalFiscal: string | null;
  banco: string | null;
  cuentaBancaria: string | null;
  pagoCheque: boolean;
}

export interface ConceptoCorto {
  id: number;
  clave: number;
  nombre: string;
  naturaleza: 'P' | 'D';
}

export interface DatosPersonales {
  sexo: string | null;
  estadoCivil: string | null;
  correo: string | null;
  telefono: string | null;
  domicilio: string | null;
  colonia: string | null;
  codigoPostal: string | null;
  entidad: string | null;
  profesion: string | null;
  observaciones: string | null;
}

export interface Movimiento {
  id: number;
  tipo: 'alta' | 'baja' | 'permiso' | 'reingreso' | 'cambio';
  motivo: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  detalle: Record<string, unknown> | null;
  observaciones: string | null;
  cancelado: boolean;
  registradoPor: string;
}

export interface FichaEmpleado extends EmpleadoResumen {
  datosPersonales: DatosPersonales | null;
  tabulador: { vigencia: string; sueldoMensual: number; compensacionMensual: number; gratificacionMensual: number } | null;
  sucursal: { sucursal: number; tipo: string } | null;
  fijos: { id: number; importe: number; gravaIsr: boolean | null; timbra: boolean | null; concepto: ConceptoCorto }[];
  descuentosPlazo: {
    id: number;
    importeQuincenal: number;
    porcentaje: number | null;
    quincenasPendientes: number | null;
    beneficiario: string | null;
    activo: boolean;
    concepto: ConceptoCorto;
  }[];
  cuentasContables: { id: number; partida: string; concepto: ConceptoCorto }[];
  movimientos: Movimiento[];
  recibos: {
    id: number;
    tipo: TipoCalculo;
    anio: number;
    quincena: number;
    totalPercepciones: number;
    totalDeducciones: number;
    neto: number;
  }[];
}

export type OrigenClave = 'calculado' | 'fija' | 'plazo' | 'captura';

export interface QuincenaEmpleado {
  periodo: { id: number | null; nombre: string; estado: EstadoPeriodo | null };
  dias: number;
  lineas: { conceptoId: number; clave: number; descripcion: string; naturaleza: 'P' | 'D'; importe: number; gravadoIsr: number; timbra: boolean; factorIssemym: number; origenes: OrigenClave[] }[];
  baseIsr: number;
  baseIssemym: number;
  isrCausado: number;
  subsidio: number;
  totalPercepciones: number;
  totalDeducciones: number;
  neto: number;
  observaciones: string[];
}

/** Un recibo calculado sin guardarse. */
export interface ReciboPrueba {
  lineas: { conceptoId: number; clave: number; descripcion: string; naturaleza: 'P' | 'D'; importe: number }[];
  totalPercepciones: number;
  totalDeducciones: number;
  neto: number;
}

export interface OpcionAjuste {
  conceptoId: number;
  clave: number;
  descripcion: string;
  gravaIsr: boolean;
  importe: number;
}

export interface AjusteNeto {
  empleadoId: number;
  nombre: string;
  recibo: ReciboPrueba;
  percepciones: OpcionAjuste[];
  deducciones: OpcionAjuste[];
  ajustes: { id: number; clave: number; descripcion: string; importe: number; referencia: string | null; registradoPor: string }[];
}

export interface VistaRetroactivo {
  desde: string;
  quincenas: number;
  empleados: number;
  total: number;
  sinNivel: number;
  yaRetro: number;
  claves: { clave: number; descripcion: string; empleados: number; total: number }[];
  muestra: { empleadoId: number; nombre: string; quincenas: number; total: number }[];
}

export interface ResultadoTablaRang {
  vigencia: string;
  niveles: number;
  nuevos: number;
  cambian: number;
  iguales: number;
  faltan: number[];
  muestra: { nivel: number; antes: number | null; despues: number }[];
  aplicado: boolean;
}

export interface MetodoIsr {
  /** Tarifa mensual (doble de la quincena entre dos) en lugar de quincenal. */
  mensual: boolean;
  /** En la 2a quincena, ISR del mes menos lo retenido en la 1a. */
  ajuste: boolean;
  redondeo: number;
  minimo: number;
  tarifa: [number, number, number][];
  subsidio: [number, number][];
}

/** Datos del Análisis de ISR. Las líneas van compactas: [índice del recibo, concepto, centavos]. */
export interface DatosAnalisis {
  tipoNomina: string;
  anio: number;
  anios: number[];
  parametros: { umaDiaria: number; diasQuincena: number };
  tarifa: [number, number, number][];
  subsidio: [number, number][];
  conceptos: { id: number; clave: number; descripcion: string; naturaleza: 'P' | 'D'; gravaIsr: boolean; calculado: string | null }[];
  periodos: { tipo: TipoCalculo; anio: number; quincena: number; cerrado: boolean; metodo: number }[];
  /** Con qué tablas y método se calculó cada quincena. */
  metodos: MetodoIsr[];
  empleados: { id: number; nombre: string; rfc: string; adscripcion: string; nivel: number; rango: number }[];
  recibos: { id: number; e: number; p: number; dias: number }[];
  lineas: [number, number, number][];
}

export interface MovimientoLista {
  id: number;
  empleadoId: number;
  nombre: string;
  curp: string;
  tipo: Movimiento['tipo'];
  motivo: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  observaciones: string | null;
  cancelado: boolean;
  registradoPor: string;
}

export interface Captura {
  id: number;
  empleadoId: number;
  nombre: string;
  curp: string;
  conceptoId: number;
  clave: number;
  concepto: string;
  naturaleza: 'P' | 'D';
  importe: number;
  /** null = como la quincena o el catálogo. */
  gravaIsr: boolean | null;
  timbra: boolean | null;
  /** La calcula el sistema (la captura es solo una diferencia): sus marcas no se cambian aquí. */
  calculado: boolean;
  origen: string;
  referencia: string | null;
  registradoPor: string;
  creadoEl: string;
}

export interface ReciboFila {
  id: number;
  empleadoId: number;
  nombre: string;
  curp: string;
  adscripcion: string;
  nivel: number;
  rango: number;
  dias: number;
  totalPercepciones: number;
  totalDeducciones: number;
  neto: number;
  observaciones: string[];
}

export interface ReciboDetalle {
  id: number;
  calculo: Calculo;
  periodo: Periodo;
  empleadoId: number;
  nombre: string;
  curp: string;
  rfc: string;
  adscripcion: string;
  puesto: string;
  nivel: number;
  rango: number;
  dias: number;
  baseIsr: number;
  baseIssemym: number;
  isrCausado: number;
  subsidio: number;
  totalPercepciones: number;
  totalDeducciones: number;
  neto: number;
  cuentaBancaria: string | null;
  pagoCheque: boolean;
  observaciones: string[];
  conceptos: { clave: number; claveGem: number | null; descripcion: string; naturaleza: 'P' | 'D'; importe: number; gravadoIsr: number; timbra: boolean }[];
}

export interface Diagnostico {
  clave: string;
  titulo: string;
  descripcion: string;
  severidad: 'error' | 'aviso';
  legado: string;
  total: number;
  muestras: { empleadoId: number | null; nombre: string; detalle: string }[];
}

export interface ReciboPago {
  id: number;
  empleadoId: number;
  nombre: string;
  rfc: string;
  cuenta: string | null;
  neto: number;
}

export interface ResumenDispersion {
  calculo: { id: number; tipo: TipoCalculo; periodoId: number };
  layouts: { clave: string; nombre: string; extension: string; legado: string }[];
  transferencia: { total: number; importe: number };
  cheque: { total: number; importe: number; recibos: ReciboPago[] };
  sinCuenta: { total: number; importe: number; recibos: ReciboPago[] };
}

export interface ColumnaReporte {
  clave: string;
  titulo: string;
  tipo?: 'texto' | 'dinero' | 'numero' | 'fecha';
}

export interface DefinicionReporte {
  clave: string;
  titulo: string;
  descripcion: string;
  grupo: string;
  legado: string;
  filtro: 'calculo' | 'mes' | 'anio' | 'nomina';
  columnas: ColumnaReporte[];
  totales?: string[];
  ordenes?: { valor: string; etiqueta: string }[];
}

export interface TablaReporte {
  titulo: string;
  subtitulo?: string;
  columnas: ColumnaReporte[];
  filas: Record<string, unknown>[];
  totales?: Record<string, number>;
}

export interface CampoCatalogo {
  clave: string;
  titulo: string;
  tipo: 'texto' | 'entero' | 'dinero' | 'decimal' | 'fecha' | 'booleano' | 'opcion';
  requerido?: boolean;
  max?: number;
  opciones?: { valor: string; etiqueta: string }[] | 'tiposNomina';
  llave?: boolean;
  soloFormulario?: boolean;
  ayuda?: string;
}

export interface DefinicionCatalogo {
  clave: string;
  titulo: string;
  descripcion: string;
  legado: string;
  llave: string;
  campos: CampoCatalogo[];
  porTipoNomina?: boolean;
  soloEdicion?: boolean;
  total: number;
}

export interface Tablero {
  periodo: Periodo | null;
  plantilla: { activos: number; permiso: number; bajas: number };
  capturas: { total: number; empleados: number };
  movimientos: Record<string, number>;
  calculos: (Pick<Calculo, 'id' | 'tipo' | 'estado' | 'totalNeto' | 'totalPercepciones' | 'totalDeducciones' | 'totalEmpleados' | 'procesados' | 'terminadoEl'>)[];
  historico: { etiqueta: string; anio: number; quincena: number; neto: number; percepciones: number; empleados: number }[];
}

export interface ResultadoSimulacion {
  lineas: { conceptoId: number; clave: number; descripcion: string; naturaleza: 'P' | 'D'; importe: number; gravadoIsr: number }[];
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

export interface UsuarioSistema {
  id: number;
  usuario: string;
  nombre: string;
  rol: string;
  activo: boolean;
  ultimoAcceso: string | null;
}

/** La misma clave a muchas personas. */
export interface DatosMasiva {
  conceptoId: number;
  importe: number;
  gravaIsr: boolean | null;
  timbra: boolean | null;
  referencia?: string;
  filtro: { adscripciones?: number[]; nivelDesde?: number; nivelHasta?: number; omitirConClave: boolean; soloConPago: boolean };
}

export interface VistaMasiva {
  personas: number;
  total: number;
  isr: number;
  issemym: number;
  neto: number;
  netoMenor: number;
  netoMayor: number;
  conClave: number;
  sinPago: number;
  quedanNegativos: number;
  naturaleza: 'P' | 'D';
  cotiza: boolean;
}

export interface MasivaHecha {
  id: number;
  clave: number;
  descripcion: string;
  naturaleza: 'P' | 'D';
  importe: number;
  gravaIsr: boolean;
  timbra: boolean;
  referencia: string | null;
  personas: number;
  registradoPor: string;
  creadaEl: string;
  deshechoPor: string | null;
  deshechoEl: string | null;
}

export type EstadoExterno = 'pendiente' | 'aplicando' | 'aplicado' | 'descartado';

/** Un sistema del que se traen movimientos. */
export interface SistemaExterno {
  clave: 'personal' | 'checador' | 'prestamos';
  nombre: string;
  descripcion: string;
  tipos: Record<string, string>;
  conectado: boolean;
  pendientes: number;
  aplicados: number;
  descartados: number;
  ultima: { fecha: string; usuario: string; nuevos: number; error: string | null } | null;
}

export interface AjustesExterno {
  banco?: string | null;
  cuentaBancaria?: string | null;
  pagoCheque?: boolean;
  claves?: { clave: number; importe: number; cada: 'quincena' | 'esta' }[];
}

export interface ReciboExterno {
  problema: string | null;
  quincena?: string;
  nivel?: number;
  rango?: number;
  dias?: number;
  lineas?: { clave: number; descripcion: string; naturaleza: 'P' | 'D'; importe: number }[];
  totalPercepciones?: number;
  totalDeducciones?: number;
  neto?: number;
  /** Suma de las percepciones que se capturaron en Personal, que van por mes. */
  percepcionesPersonalMes?: number | null;
}

export interface MovimientoExterno {
  id: number;
  tipo: string;
  tipoNombre: string;
  subtipo: string | null;
  nombre: string;
  curp: string | null;
  tipoNomina: string | null;
  anio: number | null;
  quincena: number | null;
  fecha: string | null;
  lote: string | null;
  estado: EstadoExterno;
  mensaje: string | null;
  empleadoId: number | null;
  efecto: string[];
  avisos: string[];
  problema: string | null;
  ajustes: AjustesExterno | null;
  /** La cuenta que mandó Personal, si mandó. */
  cuentaPersonal: string | null;
  atendidoPor: string | null;
  atendidoEl: string | null;
  traidoEl: string;
}

export interface RegistroBitacora {
  id: number;
  usuario: string;
  entidad: string;
  entidadId: string | null;
  accion: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  fecha: string;
  persona: string | null;
  clave: string | null;
  quincena: string | null;
}

export const NOMBRE_CALCULO: Record<TipoCalculo, string> = {
  prenomina: 'Prenómina',
  nomina: 'Nómina',
  aguinaldo: 'Aguinaldo',
  prima_vacacional: 'Prima vacacional',
  legado: 'Pagado (sistema anterior)',
};

export const NOMBRE_ESTADO_PERIODO: Record<EstadoPeriodo, string> = {
  captura: 'En captura',
  prenomina: 'Prenómina calculada',
  nomina: 'Nómina calculada',
  cerrado: 'Cerrada',
};
