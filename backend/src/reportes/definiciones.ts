import type { ColumnaTabla } from '../common/excel';

/** Qué datos pide el reporte para ejecutarse. */
export type FiltroReporte = 'calculo' | 'mes' | 'anio' | 'nomina';

export interface DefinicionReporte {
  clave: string;
  titulo: string;
  descripcion: string;
  grupo: 'Nómina' | 'Pagos' | 'Fiscal' | 'Seguridad social' | 'Contabilidad' | 'Personal';
  legado: string;
  filtro: FiltroReporte;
  columnas: ColumnaTabla[];
  /** Columnas que se suman en el renglón de total. */
  totales?: string[];
  /** Opciones extra del reporte (orden de firmas). */
  ordenes?: { valor: string; etiqueta: string }[];
  /** Consulta. Recibe :calculo, :calculos (lista), :tipo, :anio, :mes y :orden. */
  sql: string;
}

const NOMBRE = "concat_ws(' ', e.apellido_paterno, e.apellido_materno, e.nombres)";

/** Recibos de un concepto calculado (isr, issemym_salud…) dentro de los cálculos pedidos. */
const importeCalculado = (calculado: string) =>
  `coalesce(sum(rc.importe) FILTER (WHERE co.calculado = '${calculado}'), 0)`;

export const REPORTES: DefinicionReporte[] = [
  {
    clave: 'nomina',
    titulo: 'Reporte de nómina',
    descripcion: 'Percepciones, deducciones y neto de cada empleado.',
    grupo: 'Nómina',
    legado: '1REP-N-P.W',
    filtro: 'calculo',
    columnas: [
      { clave: 'nombre', titulo: 'Empleado' },
      { clave: 'curp', titulo: 'CURP' },
      { clave: 'adscripcion', titulo: 'Adscripción' },
      { clave: 'nivel', titulo: 'Nivel', tipo: 'numero' },
      { clave: 'dias', titulo: 'Días', tipo: 'numero' },
      { clave: 'percepciones', titulo: 'Percepciones', tipo: 'dinero' },
      { clave: 'deducciones', titulo: 'Deducciones', tipo: 'dinero' },
      { clave: 'neto', titulo: 'Neto', tipo: 'dinero' },
    ],
    totales: ['percepciones', 'deducciones', 'neto'],
    sql: `SELECT r.nombre, r.curp, a.descripcion adscripcion, r.nivel, r.dias::float dias,
                 r.total_percepciones::float percepciones, r.total_deducciones::float deducciones, r.neto::float neto
          FROM recibos r LEFT JOIN adscripciones a ON a.id = r.adscripcion_id
          WHERE r.calculo_id = :calculo ORDER BY r.nombre`,
  },
  {
    clave: 'resumen-areas',
    titulo: 'Resumen por áreas presupuestales',
    descripcion: 'Totales de la nómina agrupados por adscripción.',
    grupo: 'Nómina',
    legado: '1RES-N-A.W',
    filtro: 'calculo',
    columnas: [
      { clave: 'area', titulo: 'Área presupuestal' },
      { clave: 'adscripcion', titulo: 'Adscripción' },
      { clave: 'empleados', titulo: 'Empleados', tipo: 'numero' },
      { clave: 'percepciones', titulo: 'Percepciones', tipo: 'dinero' },
      { clave: 'deducciones', titulo: 'Deducciones', tipo: 'dinero' },
      { clave: 'neto', titulo: 'Neto', tipo: 'dinero' },
    ],
    totales: ['empleados', 'percepciones', 'deducciones', 'neto'],
    sql: `SELECT coalesce(a.area_presupuestal, '—') area, a.descripcion adscripcion, count(*)::int empleados,
                 sum(r.total_percepciones)::float percepciones, sum(r.total_deducciones)::float deducciones, sum(r.neto)::float neto
          FROM recibos r LEFT JOIN adscripciones a ON a.id = r.adscripcion_id
          WHERE r.calculo_id = :calculo GROUP BY a.area_presupuestal, a.id, a.descripcion ORDER BY 1, 2`,
  },
  {
    clave: 'costo-conceptos',
    titulo: 'Costo de la nómina por concepto',
    descripcion: 'Cuánto suma cada clave de percepción y deducción.',
    grupo: 'Nómina',
    legado: 'DCON-C-T.W',
    filtro: 'calculo',
    columnas: [
      { clave: 'clave', titulo: 'Clave', tipo: 'numero' },
      { clave: 'concepto', titulo: 'Concepto' },
      { clave: 'tipo', titulo: 'Tipo' },
      { clave: 'partida', titulo: 'Partida' },
      { clave: 'empleados', titulo: 'Empleados', tipo: 'numero' },
      { clave: 'importe', titulo: 'Importe', tipo: 'dinero' },
    ],
    sql: `SELECT rc.clave, rc.descripcion concepto, CASE rc.naturaleza WHEN 'P' THEN 'Percepción' ELSE 'Deducción' END tipo,
                 coalesce(rc.partida, '') partida, count(DISTINCT rc.recibo_id)::int empleados, sum(rc.importe)::float importe
          FROM recibo_conceptos rc JOIN recibos r ON r.id = rc.recibo_id
          WHERE r.calculo_id = :calculo GROUP BY rc.clave, rc.descripcion, rc.naturaleza, rc.partida
          ORDER BY rc.naturaleza DESC, rc.clave`,
  },
  {
    clave: 'firmas',
    titulo: 'Relación para firmas',
    descripcion: 'Listado para recabar firma de recibido, por orden alfabético o por adscripción.',
    grupo: 'Pagos',
    legado: '1REP-F-D.W, 1R-F-DFR.W',
    filtro: 'calculo',
    ordenes: [
      { valor: 'alfabetico', etiqueta: 'Orden alfabético' },
      { valor: 'adscripcion', etiqueta: 'Por adscripción (fracción política)' },
    ],
    columnas: [
      { clave: 'adscripcion', titulo: 'Adscripción' },
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'rfc', titulo: 'RFC' },
      { clave: 'neto', titulo: 'Neto', tipo: 'dinero' },
      { clave: 'firma', titulo: 'Firma' },
    ],
    totales: ['neto'],
    sql: `SELECT a.descripcion adscripcion, r.nombre, r.rfc, r.neto::float neto, '' firma
          FROM recibos r LEFT JOIN adscripciones a ON a.id = r.adscripcion_id
          WHERE r.calculo_id = :calculo
          ORDER BY CASE WHEN :orden = 'adscripcion' THEN a.descripcion ELSE '' END, r.nombre`,
  },
  {
    clave: 'depositos',
    titulo: 'Relación de depósitos bancarios',
    descripcion: 'Lo que se paga por transferencia, cuenta por cuenta.',
    grupo: 'Pagos',
    legado: '1LIS-COM.W',
    filtro: 'calculo',
    columnas: [
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'rfc', titulo: 'RFC' },
      { clave: 'cuenta', titulo: 'Cuenta' },
      { clave: 'neto', titulo: 'Importe', tipo: 'dinero' },
    ],
    totales: ['neto'],
    sql: `SELECT r.nombre, r.rfc, r.cuenta_bancaria cuenta, r.neto::float neto
          FROM recibos r WHERE r.calculo_id = :calculo AND NOT r.pago_cheque AND coalesce(r.cuenta_bancaria, '') <> '' AND r.neto > 0
          ORDER BY r.nombre`,
  },
  {
    clave: 'cheques',
    titulo: 'Relación de cheques',
    descripcion: 'Empleados que cobran con cheque y su importe.',
    grupo: 'Pagos',
    legado: '1LIS-CHE.W, 1REP-CHE.W',
    filtro: 'calculo',
    columnas: [
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'rfc', titulo: 'RFC' },
      { clave: 'neto', titulo: 'Importe', tipo: 'dinero' },
    ],
    totales: ['neto'],
    sql: `SELECT r.nombre, r.rfc, r.neto::float neto FROM recibos r
          WHERE r.calculo_id = :calculo AND (r.pago_cheque OR coalesce(r.cuenta_bancaria, '') = '') AND r.neto > 0
          ORDER BY r.nombre`,
  },
  {
    clave: 'isr-mensual',
    titulo: 'ISR retenido en el mes',
    descripcion: 'Base gravable, ISR causado, subsidio y retenido por empleado, sumando las quincenas del mes.',
    grupo: 'Fiscal',
    legado: '1REP-M-I.W, 1REP-M-C.W',
    filtro: 'mes',
    columnas: [
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'rfc', titulo: 'RFC' },
      { clave: 'gravado', titulo: 'Base gravable', tipo: 'dinero' },
      { clave: 'causado', titulo: 'ISR causado', tipo: 'dinero' },
      { clave: 'subsidio', titulo: 'Subsidio', tipo: 'dinero' },
      { clave: 'retenido', titulo: 'ISR retenido', tipo: 'dinero' },
    ],
    totales: ['gravado', 'causado', 'subsidio', 'retenido'],
    sql: `SELECT r.nombre, r.rfc, sum(r.base_isr)::float gravado, sum(r.isr_causado)::float causado, sum(r.subsidio)::float subsidio,
                 coalesce(sum(i.importe), 0)::float retenido
          FROM recibos r
          LEFT JOIN LATERAL (SELECT sum(rc.importe) importe FROM recibo_conceptos rc JOIN conceptos co ON co.id = rc.concepto_id
                             WHERE rc.recibo_id = r.id AND co.calculado = 'isr') i ON true
          WHERE r.calculo_id IN (:calculos) GROUP BY r.empleado_id, r.nombre, r.rfc ORDER BY r.nombre`,
  },
  {
    clave: 'acumulado-anual',
    titulo: 'Percepciones acumuladas del año',
    descripcion: 'Lo pagado, gravado y retenido a cada empleado en el año, para la declaración anual.',
    grupo: 'Fiscal',
    legado: '1R-A-B-N.W, 1REP-P-G.W',
    filtro: 'anio',
    columnas: [
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'rfc', titulo: 'RFC' },
      { clave: 'percepciones', titulo: 'Percepciones', tipo: 'dinero' },
      { clave: 'gravado', titulo: 'Gravado', tipo: 'dinero' },
      { clave: 'isr', titulo: 'ISR retenido', tipo: 'dinero' },
      { clave: 'neto', titulo: 'Neto pagado', tipo: 'dinero' },
    ],
    totales: ['percepciones', 'gravado', 'isr', 'neto'],
    sql: `SELECT r.nombre, r.rfc, sum(r.total_percepciones)::float percepciones, sum(r.base_isr)::float gravado,
                 coalesce(sum(i.importe), 0)::float isr, sum(r.neto)::float neto
          FROM recibos r
          LEFT JOIN LATERAL (SELECT sum(rc.importe) importe FROM recibo_conceptos rc JOIN conceptos co ON co.id = rc.concepto_id
                             WHERE rc.recibo_id = r.id AND co.calculado = 'isr') i ON true
          WHERE r.calculo_id IN (:calculos) GROUP BY r.empleado_id, r.nombre, r.rfc ORDER BY r.nombre`,
  },
  {
    clave: 'issemym',
    titulo: 'Deducciones ISSEMYM',
    descripcion: 'Base de cotización y cuotas de cada empleado.',
    grupo: 'Seguridad social',
    legado: '1DED-ISS.W, COMP-ISS.W',
    filtro: 'calculo',
    columnas: [
      { clave: 'issemym', titulo: 'Núm. ISSEMYM', tipo: 'numero' },
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'base', titulo: 'Base de cotización', tipo: 'dinero' },
      { clave: 'salud', titulo: 'Servicios de salud', tipo: 'dinero' },
      { clave: 'pension', titulo: 'Pensiones', tipo: 'dinero' },
      { clave: 'total', titulo: 'Total', tipo: 'dinero' },
    ],
    totales: ['base', 'salud', 'pension', 'total'],
    sql: `SELECT e.numero_issemym issemym, r.nombre, r.base_issemym::float base,
                 ${importeCalculado('issemym_salud')}::float salud, ${importeCalculado('issemym_pension')}::float pension,
                 (${importeCalculado('issemym_salud')} + ${importeCalculado('issemym_pension')})::float total
          FROM recibos r JOIN empleados e ON e.id = r.empleado_id
          LEFT JOIN recibo_conceptos rc ON rc.recibo_id = r.id LEFT JOIN conceptos co ON co.id = rc.concepto_id
          WHERE r.calculo_id = :calculo GROUP BY r.id, e.numero_issemym ORDER BY r.nombre`,
  },
  {
    clave: 'poliza',
    titulo: 'Póliza para contabilidad y presupuesto',
    descripcion: 'El costo de la nómina por partida, listo para registrarse.',
    grupo: 'Contabilidad',
    legado: '1TRA-C-N.W, 1TRA-SCI.W',
    filtro: 'calculo',
    columnas: [
      { clave: 'partida', titulo: 'Partida' },
      { clave: 'conceptos', titulo: 'Claves' },
      { clave: 'cargo', titulo: 'Cargo (percepciones)', tipo: 'dinero' },
      { clave: 'abono', titulo: 'Abono (deducciones)', tipo: 'dinero' },
    ],
    totales: ['cargo', 'abono'],
    sql: `SELECT coalesce(nullif(rc.partida, ''), 'SIN PARTIDA') partida, string_agg(DISTINCT rc.clave::text, ', ') conceptos,
                 coalesce(sum(rc.importe) FILTER (WHERE rc.naturaleza = 'P'), 0)::float cargo,
                 coalesce(sum(rc.importe) FILTER (WHERE rc.naturaleza = 'D'), 0)::float abono
          FROM recibo_conceptos rc JOIN recibos r ON r.id = rc.recibo_id
          WHERE r.calculo_id = :calculo GROUP BY 1 ORDER BY 1`,
  },
  {
    clave: 'empleados-cuenta',
    titulo: 'Empleados con cuenta bancaria',
    descripcion: 'Banco, cuenta y sucursal de cada empleado activo.',
    grupo: 'Personal',
    legado: '1RE-E-CB.W',
    filtro: 'nomina',
    columnas: [
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'curp', titulo: 'CURP' },
      { clave: 'banco', titulo: 'Banco' },
      { clave: 'cuenta', titulo: 'Cuenta' },
      { clave: 'sucursal', titulo: 'Sucursal', tipo: 'numero' },
      { clave: 'pago', titulo: 'Forma de pago' },
    ],
    sql: `SELECT ${NOMBRE} nombre, e.curp, coalesce(e.banco, '') banco, coalesce(e.cuenta_bancaria, '') cuenta, s.sucursal,
                 CASE WHEN e.pago_cheque THEN 'Cheque' WHEN coalesce(e.cuenta_bancaria, '') = '' THEN 'Sin cuenta' ELSE 'Transferencia' END pago
          FROM empleados e LEFT JOIN sucursales_bancarias s ON s.empleado_id = e.id
          WHERE e.tipo_nomina = :tipo AND e.estado <> 'baja' ORDER BY 1`,
  },
  {
    clave: 'permisos',
    titulo: 'Permisos y suspensiones del año',
    descripcion: 'Permisos registrados, con su motivo y si se cancelaron.',
    grupo: 'Personal',
    legado: '1VERI-PERM.W, DCON-PER.P',
    filtro: 'anio',
    columnas: [
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'motivo', titulo: 'Motivo' },
      { clave: 'inicio', titulo: 'Desde', tipo: 'fecha' },
      { clave: 'fin', titulo: 'Hasta', tipo: 'fecha' },
      { clave: 'estado', titulo: 'Estado' },
    ],
    sql: `SELECT ${NOMBRE} nombre, coalesce(mo.descripcion, '') motivo, to_char(m.fecha_inicio, 'DD/MM/YYYY') inicio,
                 coalesce(to_char(m.fecha_fin, 'DD/MM/YYYY'), 'Abierto') fin, CASE WHEN m.cancelado THEN 'Cancelado' ELSE 'Vigente' END estado
          FROM movimientos_personal m JOIN empleados e ON e.id = m.empleado_id LEFT JOIN motivos mo ON mo.clave = m.motivo_clave
          WHERE m.tipo = 'permiso' AND e.tipo_nomina = :tipo AND extract(year FROM m.fecha_inicio) = :anio
          ORDER BY m.fecha_inicio DESC`,
  },
  {
    clave: 'altas-bajas',
    titulo: 'Altas y bajas del año',
    descripcion: 'Movimientos de ingreso, reingreso y baja.',
    grupo: 'Personal',
    legado: 'REP-AB.W',
    filtro: 'anio',
    columnas: [
      { clave: 'fecha', titulo: 'Fecha', tipo: 'fecha' },
      { clave: 'movimiento', titulo: 'Movimiento' },
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'curp', titulo: 'CURP' },
      { clave: 'motivo', titulo: 'Motivo' },
    ],
    sql: `SELECT to_char(m.fecha_inicio, 'DD/MM/YYYY') fecha, initcap(m.tipo) movimiento, ${NOMBRE} nombre, e.curp,
                 coalesce(mo.descripcion, '') motivo
          FROM movimientos_personal m JOIN empleados e ON e.id = m.empleado_id LEFT JOIN motivos mo ON mo.clave = m.motivo_clave
          WHERE m.tipo IN ('alta', 'baja', 'reingreso') AND NOT m.cancelado AND e.tipo_nomina = :tipo
            AND extract(year FROM m.fecha_inicio) = :anio
          ORDER BY m.fecha_inicio DESC, nombre`,
  },
];
