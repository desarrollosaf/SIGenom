import type { ModelStatic, Model } from 'sequelize';
import {
  Adscripcion,
  Concepto,
  Motivo,
  Parametro,
  Puesto,
  TablaIsr,
  TablaSubsidio,
  Tabulador,
  TipoNomina,
} from '../database/models/catalogos.models';

export type TipoCampo = 'texto' | 'entero' | 'dinero' | 'decimal' | 'fecha' | 'booleano' | 'opcion';

export interface CampoCatalogo {
  clave: string;
  titulo: string;
  tipo: TipoCampo;
  requerido?: boolean;
  max?: number;
  /** Opciones fijas, o el nombre de una lista de /catalogos/opciones. */
  opciones?: { valor: string; etiqueta: string }[] | 'tiposNomina';
  /** La llave primaria capturada a mano: se escribe al crear y ya no cambia. */
  llave?: boolean;
  /** Se muestra en el formulario pero no en la tabla. */
  soloFormulario?: boolean;
  ayuda?: string;
}

export interface DefinicionCatalogo {
  clave: string;
  titulo: string;
  descripcion: string;
  /** Programa del sistema anterior que hacía lo mismo. */
  legado: string;
  modelo: ModelStatic<Model>;
  llave: string;
  campos: CampoCatalogo[];
  orden: [string, 'ASC' | 'DESC'][];
  /** Se filtra por el tipo de nómina elegido arriba (los conceptos son por tipo de nómina). */
  porTipoNomina?: boolean;
  /** No se pueden crear ni borrar renglones, solo editar (parámetros). */
  soloEdicion?: boolean;
}

const SI_NO = [
  { valor: 'true', etiqueta: 'Sí' },
  { valor: 'false', etiqueta: 'No' },
];
const activo: CampoCatalogo = { clave: 'activo', titulo: 'Activo', tipo: 'booleano' };

export const CATALOGOS: DefinicionCatalogo[] = [
  {
    clave: 'conceptos',
    titulo: 'Percepciones y deducciones',
    descripcion: 'Claves de pago y descuento de cada tipo de nómina, con lo que gravan.',
    legado: '1ABC-PD.W',
    modelo: Concepto,
    llave: 'id',
    porTipoNomina: true,
    orden: [
      ['naturaleza', 'DESC'],
      ['clave', 'ASC'],
    ],
    campos: [
      { clave: 'tipoNomina', titulo: 'Nómina', tipo: 'opcion', opciones: 'tiposNomina', requerido: true, soloFormulario: true },
      { clave: 'clave', titulo: 'Clave', tipo: 'entero', requerido: true },
      { clave: 'abreviatura', titulo: 'Abrev.', tipo: 'texto', max: 12, requerido: true },
      { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto', max: 60, requerido: true },
      {
        clave: 'naturaleza',
        titulo: 'Tipo',
        tipo: 'opcion',
        requerido: true,
        opciones: [
          { valor: 'P', etiqueta: 'Percepción' },
          { valor: 'D', etiqueta: 'Deducción' },
        ],
      },
      {
        clave: 'periodicidad',
        titulo: 'Periodicidad',
        tipo: 'opcion',
        requerido: true,
        opciones: [
          { valor: 'F', etiqueta: 'Fija' },
          { valor: 'E', etiqueta: 'Eventual' },
        ],
      },
      { clave: 'gravaIsr', titulo: 'Grava ISR', tipo: 'booleano' },
      {
        clave: 'timbra',
        titulo: 'Se timbra',
        tipo: 'booleano',
        ayuda: 'Va en el CFDI de nómina. Para una sola quincena se cambia en Cálculo > Ajustes de la quincena.',
      },
      { clave: 'factorIssemym', titulo: 'Factor ISSEMYM', tipo: 'decimal', ayuda: 'De 0 a 1: qué parte integra la base de cotización.' },
      { clave: 'partida', titulo: 'Partida', tipo: 'texto', max: 16 },
      { clave: 'claveIssemym', titulo: 'Clave ISSEMYM', tipo: 'entero', soloFormulario: true },
      {
        clave: 'calculado',
        titulo: 'Lo calcula el sistema',
        tipo: 'opcion',
        soloFormulario: true,
        ayuda: 'Solo para los conceptos que genera el motor; los demás se capturan.',
        opciones: [
          { valor: '', etiqueta: 'No, se captura' },
          { valor: 'sueldo', etiqueta: 'Sueldo' },
          { valor: 'compensacion', etiqueta: 'Compensación (tabulador)' },
          { valor: 'gratificacion', etiqueta: 'Gratificación (tabulador)' },
          { valor: 'isr', etiqueta: 'ISR' },
          { valor: 'issemym_salud', etiqueta: 'ISSEMYM servicios de salud' },
          { valor: 'issemym_pension', etiqueta: 'ISSEMYM pensiones' },
          { valor: 'issemym_salud_retro', etiqueta: 'ISSEMYM salud del retroactivo' },
          { valor: 'issemym_pens_retro', etiqueta: 'ISSEMYM pensiones del retroactivo' },
          { valor: 'sci', etiqueta: 'SCI obligatorio' },
          { valor: 'sci_retro', etiqueta: 'SCI del retroactivo' },
          { valor: 'aguinaldo', etiqueta: 'Aguinaldo' },
          { valor: 'prima_vacacional', etiqueta: 'Prima vacacional' },
        ],
      },
      activo,
    ],
  },
  {
    clave: 'tabulador',
    titulo: 'Tabulador de nivel y rango',
    descripcion:
      'Lo que gana cada nivel y rango. Con cada aumento usa Importar tabla-rang: se guarda como una tabla nueva con su fecha y las quincenas anteriores conservan la suya.',
    legado: '1ABC-NIR.W (tabla-rang)',
    modelo: Tabulador,
    llave: 'id',
    orden: [
      ['vigencia', 'DESC'],
      ['nivel', 'ASC'],
      ['rango', 'ASC'],
    ],
    campos: [
      { clave: 'vigencia', titulo: 'Vigente desde', tipo: 'fecha', requerido: true },
      { clave: 'nivel', titulo: 'Nivel', tipo: 'entero', requerido: true },
      { clave: 'rango', titulo: 'Rango', tipo: 'entero', requerido: true },
      { clave: 'sueldoMensual', titulo: 'Sueldo mensual (001)', tipo: 'dinero', requerido: true },
      { clave: 'gratificacionMensual', titulo: 'Gratificación mensual (012)', tipo: 'dinero' },
      { clave: 'compensacionMensual', titulo: 'Compensación mensual (011)', tipo: 'dinero' },
    ],
  },
  {
    clave: 'tabla-isr',
    titulo: 'Tarifa de ISR',
    descripcion: 'Tarifa del artículo 96, mensual y quincenal. El parámetro isrMensual dice cuál se usa; cada quincena toma la vigencia más reciente a su fecha.',
    legado: '1ABC-ISP.W',
    modelo: TablaIsr,
    llave: 'id',
    orden: [
      ['periodicidad', 'ASC'],
      ['vigencia', 'DESC'],
      ['limiteInferior', 'ASC'],
    ],
    campos: [
      {
        clave: 'periodicidad',
        titulo: 'Tarifa',
        tipo: 'opcion',
        requerido: true,
        opciones: [
          { valor: 'M', etiqueta: 'Mensual' },
          { valor: 'Q', etiqueta: 'Quincenal' },
        ],
      },
      { clave: 'vigencia', titulo: 'Vigente desde', tipo: 'fecha', requerido: true },
      { clave: 'limiteInferior', titulo: 'Límite inferior', tipo: 'dinero', requerido: true },
      { clave: 'cuotaFija', titulo: 'Cuota fija', tipo: 'dinero', requerido: true },
      { clave: 'porcentaje', titulo: '% excedente', tipo: 'decimal', requerido: true },
    ],
  },
  {
    clave: 'tabla-subsidio',
    titulo: 'Subsidio para el empleo',
    descripcion: 'Lo que antes era la tabla de crédito al salario. Se resta del ISR.',
    legado: '1ABC-CRE.W',
    modelo: TablaSubsidio,
    llave: 'id',
    orden: [
      ['periodicidad', 'ASC'],
      ['vigencia', 'DESC'],
      ['ingresoDesde', 'ASC'],
    ],
    campos: [
      {
        clave: 'periodicidad',
        titulo: 'Tarifa',
        tipo: 'opcion',
        requerido: true,
        opciones: [
          { valor: 'M', etiqueta: 'Mensual' },
          { valor: 'Q', etiqueta: 'Quincenal' },
        ],
      },
      { clave: 'vigencia', titulo: 'Vigente desde', tipo: 'fecha', requerido: true },
      { clave: 'ingresoDesde', titulo: 'Ingreso desde', tipo: 'dinero', requerido: true },
      { clave: 'subsidio', titulo: 'Subsidio', tipo: 'dinero', requerido: true },
    ],
  },
  {
    clave: 'adscripciones',
    titulo: 'Adscripciones',
    descripcion: 'Áreas del Poder Legislativo y su área presupuestal.',
    legado: '1ABC-ADS.W',
    modelo: Adscripcion,
    llave: 'id',
    orden: [['id', 'ASC']],
    campos: [
      { clave: 'id', titulo: 'Clave', tipo: 'entero', requerido: true, llave: true },
      { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto', max: 120, requerido: true },
      { clave: 'areaPresupuestal', titulo: 'Área presupuestal', tipo: 'texto', max: 20 },
      activo,
    ],
  },
  {
    clave: 'puestos',
    titulo: 'Puestos',
    descripcion: 'Puestos funcionales.',
    legado: '1ABC-PUE.W',
    modelo: Puesto,
    llave: 'clave',
    orden: [['clave', 'ASC']],
    campos: [
      { clave: 'clave', titulo: 'Clave', tipo: 'texto', max: 12, requerido: true, llave: true },
      { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto', max: 120, requerido: true },
      activo,
    ],
  },
  {
    clave: 'motivos',
    titulo: 'Motivos de baja y permiso',
    descripcion: 'Se eligen al registrar una baja, un permiso o una suspensión.',
    legado: '1ABC-MOT.W',
    modelo: Motivo,
    llave: 'clave',
    orden: [['clave', 'ASC']],
    campos: [
      { clave: 'clave', titulo: 'Clave', tipo: 'texto', max: 4, requerido: true, llave: true },
      { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto', max: 80, requerido: true },
      {
        clave: 'aplica',
        titulo: 'Aplica a',
        tipo: 'opcion',
        requerido: true,
        opciones: [
          { valor: 'B', etiqueta: 'Bajas' },
          { valor: 'P', etiqueta: 'Permisos' },
        ],
      },
      activo,
    ],
  },
  {
    clave: 'tipos-nomina',
    titulo: 'Tipos de nómina',
    descripcion: 'Principal, honorarios, diputados, viáticos, telefonía…',
    legado: '1CAL-N-P.W',
    modelo: TipoNomina,
    llave: 'clave',
    orden: [['orden', 'ASC']],
    campos: [
      { clave: 'clave', titulo: 'Clave', tipo: 'texto', max: 1, requerido: true, llave: true },
      { clave: 'nombre', titulo: 'Nombre', tipo: 'texto', max: 40, requerido: true },
      { clave: 'orden', titulo: 'Orden', tipo: 'entero' },
      { ...activo, opciones: SI_NO },
    ],
  },
  {
    clave: 'parametros',
    titulo: 'Parámetros de cálculo',
    descripcion: 'Tasas y tope ISSEMYM, SCI, UMA y método de ISR. Cuando cambie un valor, agrega otro renglón con su fecha: las quincenas anteriores conservan el suyo.',
    legado: 'constantes en 1CAL-N-P.W y 1CAL-A-P.W',
    modelo: Parametro,
    llave: 'id',
    orden: [
      ['clave', 'ASC'],
      ['vigencia', 'DESC'],
    ],
    campos: [
      { clave: 'clave', titulo: 'Parámetro', tipo: 'texto', max: 40, requerido: true, llave: true },
      { clave: 'vigencia', titulo: 'Vigente desde', tipo: 'fecha', requerido: true },
      { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto', max: 200, requerido: true },
      { clave: 'valor', titulo: 'Valor', tipo: 'texto', max: 200, requerido: true },
    ],
  },
];

export const definicion = (clave: string) => CATALOGOS.find((c) => c.clave === clave);
