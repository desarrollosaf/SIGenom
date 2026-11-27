'use strict';

/**
 * Lo que nómina completa a un movimiento de otro sistema antes de aplicarlo (cuenta bancaria, claves
 * extra). Va aparte de `datos` para que, si el otro sistema lo corrige, no se pierda.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('movimientos_externos', 'ajustes', { type: Sequelize.JSONB, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('movimientos_externos', 'ajustes');
  },
};
