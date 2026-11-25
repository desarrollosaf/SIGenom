'use strict';

/** Una misma clave capturada a muchas personas de una vez, para poder verla y deshacerla junta. */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const t = { transaction };
      await queryInterface.createTable('capturas_masivas', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        periodo_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'periodos', key: 'id' }, onDelete: 'CASCADE' },
        concepto_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'conceptos', key: 'id' } },
        importe: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
        grava_isr: { type: Sequelize.BOOLEAN, allowNull: true },
        timbra: { type: Sequelize.BOOLEAN, allowNull: true },
        referencia: { type: Sequelize.STRING(80), allowNull: true },
        filtro: { type: Sequelize.JSONB, allowNull: false },
        personas: { type: Sequelize.INTEGER, allowNull: false },
        registrado_por: { type: Sequelize.STRING(20), allowNull: false },
        deshecho_por: { type: Sequelize.STRING(20), allowNull: true },
        deshecho_el: { type: Sequelize.DATE, allowNull: true },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      }, t);
      await queryInterface.addIndex('capturas_masivas', ['periodo_id'], t);
      await queryInterface.addColumn('capturas', 'masiva_id', { type: Sequelize.INTEGER, allowNull: true, references: { model: 'capturas_masivas', key: 'id' }, onDelete: 'SET NULL' }, t);
      await queryInterface.addIndex('capturas', ['masiva_id'], t);
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('capturas', 'masiva_id', { transaction });
      await queryInterface.dropTable('capturas_masivas', { transaction });
    });
  },
};
