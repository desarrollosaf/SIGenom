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
 * Claves de percepción y deducción. Cada tipo de nómina tiene las suyas, como en Cata-pd; aquí se
 * crean las mismas para Principal, Honorarios y Diputados como punto de partida.
 * [clave, abreviatura, descripción, P/D, F/E, grava ISR, factor ISSEMYM, partida, calculado]
 */
const CONCEPTOS = [
  [1, 'SUELDO', 'Sueldo base', 'P', 'F', true, 1, '1131', 'sueldo'],
  [2, 'COMPENS', 'Compensación', 'P', 'F', true, 0, '1341', 'compensacion'],
  [5, 'DESPENSA', 'Despensa', 'P', 'F', true, 0, '1541', null],
  [6, 'P.ANTIG', 'Prima de antigüedad', 'P', 'F', true, 1, '1311', null],
  [8, 'PUNTUAL', 'Premio de puntualidad', 'P', 'E', true, 0, '1711', null],
  [10, 'GRATIF', 'Gratificación extraordinaria', 'P', 'E', true, 0, '1321', null],
  [15, 'AGUINALDO', 'Aguinaldo', 'P', 'E', true, 0, '1323', 'aguinaldo'],
  [16, 'P.VACAC', 'Prima vacacional', 'P', 'E', true, 0, '1322', 'prima_vacacional'],
  [20, 'REINTEG', 'Reintegro de descuento', 'P', 'E', false, 0, null, null],
  [51, 'ISR', 'Impuesto sobre la renta', 'D', 'F', false, 0, '2117', 'isr'],
  [52, 'ISSEMYM-S', 'ISSEMYM servicios de salud', 'D', 'F', false, 0, '2118', 'issemym_salud'],
  [53, 'ISSEMYM-P', 'ISSEMYM sistema de pensiones', 'D', 'F', false, 0, '2118', 'issemym_pension'],
  [60, 'SINDICAT', 'Cuota sindical', 'D', 'F', false, 0, '2119', null],
  [65, 'INASIST', 'Descuento por inasistencia', 'D', 'E', false, 0, null, null],
  [70, 'PREST-ISS', 'Préstamo ISSEMYM', 'D', 'F', false, 0, '2118', null],
  [75, 'CAJA', 'Caja de ahorro', 'D', 'F', false, 0, '2119', null],
  [80, 'PENSION', 'Pensión alimenticia', 'D', 'F', false, 0, '2119', null],
  [85, 'COMEDOR', 'Servicio de comedor', 'D', 'E', false, 0, '2119', null],
  [90, 'PREST-DIR', 'Préstamo directo', 'D', 'F', false, 0, '2119', null],
  [91, 'APORT-PAR', 'Aportación al partido', 'D', 'F', false, 0, '2119', null],
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
        CONCEPTOS.map(([clave, abreviatura, descripcion, naturaleza, periodicidad, grava_isr, factor_issemym, partida, calculado]) => ({
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
