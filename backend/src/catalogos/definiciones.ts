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
          { valor: 'compensacion', etiqueta: 'Compensación' },
          { valor: 'isr', etiqueta: 'ISR' },
          { valor: 'issemym_salud', etiqueta: 'ISSEMYM servicios de salud' },
          { valor: 'issemym_pension', etiqueta: 'ISSEMYM pensiones' },
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
    descripcion: 'Sueldo y compensación mensuales de cada nivel y rango.',
    legado: '1ABC-NIR.W',
    modelo: Tabulador,
    llave: 'id',
    orden: [
      ['nivel', 'ASC'],
      ['rango', 'ASC'],
    ],
    campos: [
      { clave: 'nivel', titulo: 'Nivel', tipo: 'entero', requerido: true },
      { clave: 'rango', titulo: 'Rango', tipo: 'entero', requerido: true },
      { clave: 'sueldoMensual', titulo: 'Sueldo mensual', tipo: 'dinero', requerido: true },
      { clave: 'compensacionMensual', titulo: 'Compensación mensual', tipo: 'dinero' },
    ],
  },
  {
    clave: 'tabla-isr',
    titulo: 'Tarifa de ISR',
    descripcion: 'Tarifa quincenal del artículo 96. Se usa la vigencia más reciente.',
    legado: '1ABC-ISP.W',
    modelo: TablaIsr,
    llave: 'id',
    orden: [
      ['vigencia', 'DESC'],
      ['limiteInferior', 'ASC'],
    ],
    campos: [
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
      ['vigencia', 'DESC'],
      ['ingresoDesde', 'ASC'],
    ],
    campos: [
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
    descripcion: 'Tasas ISSEMYM, UMA, días de aguinaldo y prima vacacional.',
    legado: 'constantes en 1CAL-N-P.W y 1CAL-A-P.W',
    modelo: Parametro,
    llave: 'clave',
    soloEdicion: true,
    orden: [['clave', 'ASC']],
    campos: [
      { clave: 'clave', titulo: 'Parámetro', tipo: 'texto', llave: true },
      { clave: 'descripcion', titulo: 'Descripción', tipo: 'texto', max: 200 },
      { clave: 'valor', titulo: 'Valor', tipo: 'texto', max: 200, requerido: true },
    ],
  },
];

export const definicion = (clave: string) => CATALOGOS.find((c) => c.clave === clave);
