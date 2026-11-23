'use strict';

/**
 * Catálogos que el sistema necesita para calcular. Se pueden correr en producción: no traen datos
 * de personas. Las tarifas son las publicadas por el SAT; revísalas contra el Anexo 8 de la RMF
 * vigente antes de la primera nómina real.
 */

const TIPOS_NOMINA = [
  { clave: 'P', nombre: 'Principal', orden: 1 },
  { clave: 'H', nombre: 'Honorarios', orden: 2 },
  { clave: 'D', nombre: 'Diputados', orden: 3 },
  { clave: 'V', nombre: 'Viáticos', orden: 4 },
  { clave: 'T', nombre: 'Telefonía', orden: 5 },
  { clave: 'O', nombre: 'Viáticos OSFEM', orden: 6 },
];

/** Tarifa quincenal del artículo 96 de la LISR (Anexo 8 RMF), vigente desde 2023. */
const TARIFA_ISR = [
  [0.01, 0.0, 1.92],
  [368.11, 7.05, 6.4],
  [3124.36, 183.45, 10.88],
  [5490.76, 441.0, 16.0],
  [6382.81, 583.65, 17.92],
  [7641.91, 809.25, 21.36],
  [15412.81, 2469.15, 23.52],
  [24292.66, 4557.75, 30.0],
  [46378.51, 11183.4, 32.0],
  [61838.11, 16130.55, 34.0],
  [185514.31, 58180.35, 35.0],
];

/**
 * Subsidio para el empleo quincenal: desde mayo de 2024 es un monto fijo (13.8 % de la UMA mensual
 * en 2025) para ingresos hasta el tope, y nada arriba de él.
 */
const SUBSIDIO = [
  [0, 237.5],
  [5085.51, 0],
];

const PARAMETROS = [
  ['diasQuincena', '15', 'Días que paga una quincena completa.'],
  ['tasaIssemymSalud', '0.04625', 'Cuota del trabajador al ISSEMYM por servicios de salud (tasa).'],
  ['tasaIssemymPension', '0.061', 'Cuota del trabajador al ISSEMYM al sistema de pensiones (tasa).'],
  ['topeIssemym', '0', 'Tope quincenal de la base de cotización ISSEMYM; 0 sin tope.'],
  ['diasAguinaldo', '40', 'Días de sueldo que se pagan de aguinaldo.'],
  ['diasPrimaVacacional', '10', 'Días de vacaciones por periodo, base de la prima vacacional.'],
  ['porcentajePrimaVacacional', '25', 'Porcentaje de prima vacacional.'],
  ['umaDiaria', '113.14', 'Valor diario de la UMA vigente.'],
  // Contrato de dispersión. En el sistema anterior estaban escritos en 1TRA-BAN.W (registro de control y global).
  ['banamex_cliente', '', 'Citibanamex: número de cliente del contrato de pago de nómina (12 dígitos).'],
  ['banamex_sucursal_cargo', '', 'Citibanamex: sucursal de la cuenta de cargo (4 dígitos).'],
  ['banamex_cuenta_cargo', '', 'Citibanamex: cuenta de cargo (20 dígitos).'],
  ['banamex_razon_social', 'GEM PODER LEGISLATIVO', 'Citibanamex: razón social del registro de control (36 caracteres).'],
];

const MOTIVOS = [
  ['B01', 'Renuncia', 'B'],
  ['B02', 'Término de nombramiento o contrato', 'B'],
  ['B03', 'Defunción', 'B'],
  ['B04', 'Jubilación o pensión', 'B'],
  ['B05', 'Cese', 'B'],
  ['P01', 'Licencia sin goce de sueldo', 'P'],
  ['P02', 'Suspensión', 'P'],
  ['P03', 'Licencia médica sin goce', 'P'],
];

/**
 * Claves de percepción y deducción con la numeración del sistema anterior (Cata-pd): percepciones
 * debajo de 500, deducciones arriba, y el retroactivo de cada una es su clave + 100.
 * La "clave GEM" del comprobante es Cata-pd.cve-iss y se guarda en clave_issemym.
 *
 * Aquí solo van las claves confirmadas en el comprobante impreso o en los programas .W/.P; el
 * catálogo completo se carga desde Cata-pd con `npm run importar:cata-pd`.
 * [clave, abreviatura, descripción, P/D, F/E, grava ISR, factor ISSEMYM, partida, calculado, clave GEM]
 */
const CONCEPTOS = [
  // Comprobante: 001/0102, 012/0105, 014/0301, 017/0107. Cotizan ISSEMYM 001, 012 y 017 (las cuotas
  // del comprobante salen exactas sobre esa suma); la prima de permanencia no, y en los recibos 2025
  // tampoco grava ISR.
  [1, 'SUELDO BASE', 'SUELDO BASE', 'P', 'F', true, 1, '1131', 'sueldo', 102],
  // Tabla-rang: 001 = IMP-NIVEL, 012 = IMP-RAN del rango, 011 = IMP-COMP del rango.
  [11, 'COMPENSACION', 'COMPENSACION', 'P', 'F', true, 1, null, 'compensacion', 104],
  [12, 'GRATIFICACI', 'GRATIFICACION', 'P', 'F', true, 1, '1341', 'gratificacion', 105],
  [14, 'PRIMA PERM', 'PRIMA PERM SERV', 'P', 'F', false, 0, '1311', null, 301],
  [17, 'GRAT EXTRA', 'GRATIFICACION EXTRA', 'P', 'F', true, 1, '1321', null, 107],
  // Comprobante de la 2a quincena de febrero 2025: 011/0104, 027/(sin GEM), 034/0512, 047/0107, 516/5565.
  // Gravado y cotización deducidos de los recibos 2025.
  [27, 'TIEMPO EXTRA', 'TIEMPO EXTRAORD', 'P', 'E', true, 0, null, null, null],
  [34, 'DESPENSA', 'DESPENSA', 'P', 'F', false, 1, null, null, 512],
  [47, 'GRATIF ESP', 'GRATIF ESPECIAL', 'P', 'E', false, 0, null, null, 107],
  // 1CAL-A-P.W guarda la prima vacacional en la 37 y el aguinaldo en la 38.
  [37, 'PRIMA VAC', 'PRIMA VACACIONAL', 'P', 'E', true, 0, '1322', 'prima_vacacional', null],
  [38, 'AGUINALDO', 'AGUINALDO', 'P', 'E', true, 0, '1323', 'aguinaldo', null],
  // Comprobante: 501/5408, 511/5541, 512/5540, 522/5414, 549/5542, 555/(sin clave GEM).
  [501, 'ISR', 'IMPTO SOBRE LA RENTA', 'D', 'F', false, 0, '2117', 'isr', 5408],
  // 1CAL-N-P.W: la pensión alimenticia es la 502.
  [502, 'PENSION ALI', 'PENSION ALIMENTICIA', 'D', 'F', false, 0, '2119', null, null],
  [511, 'FONDO SSR', 'C FONDO SIST SOL REP', 'D', 'F', false, 0, '2118', 'issemym_pension', 5541],
  [512, 'SERV SALUD', 'C SERVICIOS DE SALUD', 'D', 'F', false, 0, '2118', 'issemym_salud', 5540],
  [516, 'CRED CONSUMO', 'CREDITOS AL CONSUMO', 'D', 'F', false, 0, '2119', null, 5565],
  [522, 'INFONACOT', 'INFONACOT', 'D', 'F', false, 0, '2119', null, 5414],
  // COMP-ISS.W: 531 estancia ISSEMYM, 550 ahorro SCI (descripción tomada del comentario del programa).
  [531, 'ESTANCIA', 'ESTANCIA ISSEMYM', 'D', 'F', false, 0, '2118', null, null],
  [549, 'SCI OBLIG', 'C OBLIG SIST CAP IND', 'D', 'F', false, 0, '2118', 'sci', 5542],
  [550, 'AHORRO SCI', 'AHORRO SCI', 'D', 'F', false, 0, '2118', null, null],
  // Cuotas sobre percepciones retroactivas (clave + 100).
  [611, 'R F S S RE', 'R. FONDO DEL SISTEMA SOLIDARIO DE REPART', 'D', 'E', false, 0, '2118', 'issemym_pens_retro', 6541],
  [612, 'R SERV SAL', 'R. SERVICIO DE SALUD', 'D', 'E', false, 0, '2118', 'issemym_salud_retro', 6540],
  [649, 'R C O SCI', 'R. CUOTA OBLIGATORIA S.C.I.', 'D', 'E', false, 0, '2118', 'sci_retro', 6542],
  [555, 'COMEDOR', 'SERVICIO DE COMEDOR', 'D', 'E', false, 0, '2119', null, null],
];

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const ahora = new Date();
    const t = { created_at: ahora, updated_at: ahora };
    const opciones = { ignoreDuplicates: true };

    await queryInterface.bulkInsert('tipos_nomina', TIPOS_NOMINA.map((x) => ({ ...x, activo: true })), opciones);
    await queryInterface.bulkInsert(
      'parametros',
      PARAMETROS.map(([clave, valor, descripcion]) => ({ clave, valor, descripcion, ...t })),
      opciones,
    );
    await queryInterface.bulkInsert(
      'motivos',
      MOTIVOS.map(([clave, descripcion, aplica]) => ({ clave, descripcion, aplica, activo: true, ...t })),
      opciones,
    );
    await queryInterface.bulkInsert(
      'tabla_isr',
      TARIFA_ISR.map(([limite_inferior, cuota_fija, porcentaje]) => ({ vigencia: '2023-01-01', limite_inferior, cuota_fija, porcentaje, ...t })),
      opciones,
    );
    await queryInterface.bulkInsert(
      'tabla_subsidio',
      SUBSIDIO.map(([ingreso_desde, subsidio]) => ({ vigencia: '2025-01-01', ingreso_desde, subsidio, ...t })),
      opciones,
    );
    for (const tipo of ['P', 'H', 'D']) {
      await queryInterface.bulkInsert(
        'conceptos',
        CONCEPTOS.map(([clave, abreviatura, descripcion, naturaleza, periodicidad, grava_isr, factor_issemym, partida, calculado, clave_issemym]) => ({
          tipo_nomina: tipo,
          clave,
          abreviatura,
          descripcion,
          naturaleza,
          periodicidad,
          // Honorarios no cotizan al ISSEMYM.
          grava_isr,
          factor_issemym: tipo === 'H' ? 0 : factor_issemym,
          partida,
          clave_issemym,
          calculado,
          activo: !(tipo === 'H' && String(calculado).startsWith('issemym')),
          ...t,
        })),
        opciones,
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('conceptos', null);
    await queryInterface.bulkDelete('tabla_subsidio', null);
    await queryInterface.bulkDelete('tabla_isr', null);
    await queryInterface.bulkDelete('motivos', null);
    await queryInterface.bulkDelete('parametros', null);
    await queryInterface.bulkDelete('tipos_nomina', null);
  },
};
