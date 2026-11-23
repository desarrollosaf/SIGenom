'use strict';

/**
 * 1. Parámetros, tarifa de ISR y subsidio con lo necesario para calcular como el sistema anterior:
 *    parámetros con vigencia, y tarifa mensual (M) además de la quincenal (Q).
 * 2. Retroactivos y SCI: 611, 612, 549 y 649 los calcula el motor.
 * 3. Evidencia: cada cálculo guarda las tablas con que se hizo y cada recibo los datos del empleado.
 */
const PARAMETROS = [
  // Método comprobado con los recibos pagados en 2025 (99.98 % exactos en Principal).
  ['isrMensual', '2025-01-01', '1', 'ISR con tarifa mensual: 1 sí, 0 tarifa quincenal.'],
  ['isrAjusteMensual', '2025-01-01', '1', 'En la 2a quincena, ISR del mes menos lo retenido en la 1a: 1 sí, 0 no.'],
  // 1CAL-P-I.P, modificaciones del 19 y 21 de enero de 2026: ya no ajusta en la 2a quincena.
  ['isrAjusteMensual', '2026-01-16', '0', 'En la 2a quincena, ISR del mes menos lo retenido en la 1a: 1 sí, 0 no.'],
  ['redondeoIsr', '2025-01-01', '5', 'Redondeo del ISR en centavos: 5 (múltiplos de 5 centavos) o 1.'],
  ['redondeoIsr', '2026-01-16', '1', 'Redondeo del ISR en centavos: 5 (múltiplos de 5 centavos) o 1.'],
  ['isrMinimo', '2025-01-01', '0.05', 'ISR mínimo cuando el subsidio lo deja en cero.'],
  ['isrMinimo', '2026-01-16', '0.01', 'ISR mínimo cuando el subsidio lo deja en cero.'],
  ['tasaSci', '2025-01-01', '0.014', 'Cuota obligatoria del Sistema de Capitalización Individual (tasa).'],
  ['topeIssemym', '2025-01-01', '67841.33', 'Tope quincenal de la base de cotización ISSEMYM; 0 sin tope.'],
  ['topeIssemym', '2026-01-01', '76659.73', 'Tope quincenal de la base de cotización ISSEMYM; 0 sin tope.'],
];
const TARIFA_MENSUAL = [
  [0.01, 0, 1.92], [746.05, 14.32, 6.4], [6332.06, 371.83, 10.88], [11128.02, 893.63, 16], [12935.83, 1182.88, 17.92],
  [15487.72, 1640.18, 21.36], [31236.5, 5004.12, 23.52], [49233.01, 9236.89, 30], [93993.91, 22665.17, 32],
  [125325.21, 32691.18, 34], [375975.62, 117912.32, 35],
];
// Lo que aplicó el sistema anterior: 390 hasta la Q16 de 2025 y 474.65 desde la Q17.
const SUBSIDIO_MENSUAL = [
  ['2024-05-01', 0, 390], ['2024-05-01', 9081.01, 0],
  ['2025-09-01', 0, 474.65], ['2025-09-01', 10171.01, 0],
];
const CALCULADOS = [[549, 'sci'], [649, 'sci_retro'], [611, 'issemym_pens_retro'], [612, 'issemym_salud_retro']];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const t = { transaction };
      const sql = (q, replacements) => queryInterface.sequelize.query(q, { ...t, replacements });

      await sql('ALTER TABLE parametros DROP CONSTRAINT parametros_pkey');
      await sql('ALTER TABLE parametros ADD COLUMN id serial PRIMARY KEY');
      await queryInterface.addColumn('parametros', 'vigencia', { type: Sequelize.DATEONLY, allowNull: false, defaultValue: '2000-01-01' }, t);
      await queryInterface.addIndex('parametros', ['clave', 'vigencia'], { unique: true, ...t });
      for (const [clave, vigencia, valor, descripcion] of PARAMETROS) {
        await sql(`INSERT INTO parametros (clave, vigencia, valor, descripcion, created_at, updated_at)
                   VALUES (:clave, :vigencia, :valor, :descripcion, now(), now()) ON CONFLICT (clave, vigencia) DO NOTHING`,
        { clave, vigencia, valor, descripcion });
      }

      for (const tabla of ['tabla_isr', 'tabla_subsidio']) {
        await queryInterface.addColumn(tabla, 'periodicidad', { type: Sequelize.STRING(1), allowNull: false, defaultValue: 'Q' }, t);
      }
      await queryInterface.removeIndex('tabla_isr', ['vigencia', 'limite_inferior'], t);
      await queryInterface.addIndex('tabla_isr', ['periodicidad', 'vigencia', 'limite_inferior'], { unique: true, ...t });
      await queryInterface.removeIndex('tabla_subsidio', ['vigencia', 'ingreso_desde'], t);
      await queryInterface.addIndex('tabla_subsidio', ['periodicidad', 'vigencia', 'ingreso_desde'], { unique: true, ...t });
      for (const [limite, cuota, porcentaje] of TARIFA_MENSUAL) {
        await sql(`INSERT INTO tabla_isr (periodicidad, vigencia, limite_inferior, cuota_fija, porcentaje, created_at, updated_at)
                   VALUES ('M', '2023-01-01', :limite, :cuota, :porcentaje, now(), now())`, { limite, cuota, porcentaje });
      }
      for (const [vigencia, desde, subsidio] of SUBSIDIO_MENSUAL) {
        await sql(`INSERT INTO tabla_subsidio (periodicidad, vigencia, ingreso_desde, subsidio, created_at, updated_at)
                   VALUES ('M', :vigencia, :desde, :subsidio, now(), now())`, { vigencia, desde, subsidio });
      }

      for (const [clave, calculado] of CALCULADOS) {
        await sql('UPDATE conceptos SET calculado = :calculado WHERE clave = :clave AND calculado IS NULL', { clave, calculado });
      }

      await queryInterface.addColumn('calculos', 'tablas', { type: Sequelize.JSONB, allowNull: true }, t);
      await queryInterface.addColumn('recibos', 'datos', { type: Sequelize.JSONB, allowNull: true }, t);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const t = { transaction };
      const sql = (q) => queryInterface.sequelize.query(q, t);
      await queryInterface.removeColumn('recibos', 'datos', t);
      await queryInterface.removeColumn('calculos', 'tablas', t);
      await sql(`UPDATE conceptos SET calculado = NULL WHERE calculado IN ('sci', 'sci_retro', 'issemym_pens_retro', 'issemym_salud_retro')`);
      await sql(`DELETE FROM tabla_isr WHERE periodicidad = 'M'`);
      await sql(`DELETE FROM tabla_subsidio WHERE periodicidad = 'M'`);
      await queryInterface.removeIndex('tabla_isr', ['periodicidad', 'vigencia', 'limite_inferior'], t);
      await queryInterface.removeIndex('tabla_subsidio', ['periodicidad', 'vigencia', 'ingreso_desde'], t);
      await queryInterface.removeColumn('tabla_isr', 'periodicidad', t);
      await queryInterface.removeColumn('tabla_subsidio', 'periodicidad', t);
      await queryInterface.addIndex('tabla_isr', ['vigencia', 'limite_inferior'], { unique: true, ...t });
      await queryInterface.addIndex('tabla_subsidio', ['vigencia', 'ingreso_desde'], { unique: true, ...t });
      await sql(`DELETE FROM parametros a USING parametros b WHERE a.clave = b.clave AND a.vigencia < b.vigencia`);
      await queryInterface.removeIndex('parametros', ['clave', 'vigencia'], t);
      await queryInterface.removeColumn('parametros', 'id', t);
      await queryInterface.removeColumn('parametros', 'vigencia', t);
      await sql('ALTER TABLE parametros ADD PRIMARY KEY (clave)');
    });
  },
};
