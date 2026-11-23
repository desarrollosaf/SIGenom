'use strict';

/**
 * Cada captura y cada clave fija puede gravar o timbrarse distinto de su clave, solo para esa persona.
 * null = como el ajuste de la quincena o, si no hay, el catálogo.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const tabla of ['capturas', 'empleado_conceptos']) {
        for (const columna of ['grava_isr', 'timbra']) {
          await queryInterface.addColumn(tabla, columna, { type: Sequelize.BOOLEAN, allowNull: true }, { transaction });
        }
      }
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const tabla of ['capturas', 'empleado_conceptos']) {
        for (const columna of ['grava_isr', 'timbra']) await queryInterface.removeColumn(tabla, columna, { transaction });
      }
    });
  },
};
