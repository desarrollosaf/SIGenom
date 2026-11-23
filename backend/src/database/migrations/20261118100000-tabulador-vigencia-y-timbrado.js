'use strict';

/**
 * 1. Tabulador con vigencia, como la tabla-rang del sistema anterior, que cambia con cada aumento:
 *    cada quincena se calcula con el renglón vigente a su fecha y los anteriores se conservan.
 *    Se agrega la gratificación (012, IMP-RAN de la tabla-rang); la compensación es la 011 (IMP-COMP).
 * 2. Cada concepto dice si se timbra (va en el CFDI de nómina) y el recibo guarda cómo quedó.
 * 3. Ajustes por quincena: en una quincena una clave puede no gravar o no timbrarse sin tocar el catálogo.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const t = { transaction };
      await queryInterface.addColumn('tabulador', 'vigencia', { type: Sequelize.DATEONLY, allowNull: false, defaultValue: '2000-01-01' }, t);
      await queryInterface.addColumn('tabulador', 'gratificacion_mensual', { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }, t);
      await queryInterface.removeIndex('tabulador', ['nivel', 'rango'], t);
      await queryInterface.addIndex('tabulador', ['vigencia', 'nivel', 'rango'], { unique: true, ...t });

      await queryInterface.addColumn('conceptos', 'timbra', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }, t);
      await queryInterface.addColumn('recibo_conceptos', 'timbra', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }, t);

      await queryInterface.createTable(
        'periodo_conceptos',
        {
          id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
          periodo_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'periodos', key: 'id' }, onDelete: 'CASCADE' },
          concepto_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'conceptos', key: 'id' } },
          // null = como diga el catálogo.
          grava_isr: { type: Sequelize.BOOLEAN, allowNull: true },
          timbra: { type: Sequelize.BOOLEAN, allowNull: true },
          motivo: { type: Sequelize.STRING(200), allowNull: true },
          registrado_por: { type: Sequelize.STRING(20), allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        t,
      );
      await queryInterface.addIndex('periodo_conceptos', ['periodo_id', 'concepto_id'], { unique: true, ...t });

      // En el sistema anterior la 011 es la compensación y la 012 la gratificación (tabla-rang).
      await queryInterface.sequelize.query(
        `UPDATE conceptos SET calculado = 'gratificacion' WHERE clave = 12 AND calculado = 'compensacion'`, t);
      await queryInterface.sequelize.query(
        `UPDATE conceptos SET calculado = 'compensacion' WHERE clave = 11 AND calculado IS NULL
           AND NOT EXISTS (SELECT 1 FROM conceptos c2 WHERE c2.tipo_nomina = conceptos.tipo_nomina AND c2.calculado = 'compensacion')`, t);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const t = { transaction };
      await queryInterface.sequelize.query(`UPDATE conceptos SET calculado = NULL WHERE clave = 11 AND calculado = 'compensacion'`, t);
      await queryInterface.sequelize.query(`UPDATE conceptos SET calculado = 'compensacion' WHERE calculado = 'gratificacion'`, t);
      await queryInterface.dropTable('periodo_conceptos', t);
      await queryInterface.removeColumn('recibo_conceptos', 'timbra', t);
      await queryInterface.removeColumn('conceptos', 'timbra', t);
      await queryInterface.removeIndex('tabulador', ['vigencia', 'nivel', 'rango'], t);
      await queryInterface.sequelize.query(
        `DELETE FROM tabulador a USING tabulador b WHERE a.nivel = b.nivel AND a.rango = b.rango AND a.vigencia < b.vigencia`, t);
      await queryInterface.addIndex('tabulador', ['nivel', 'rango'], { unique: true, ...t });
      await queryInterface.removeColumn('tabulador', 'gratificacion_mensual', t);
      await queryInterface.removeColumn('tabulador', 'vigencia', t);
    });
  },
};
