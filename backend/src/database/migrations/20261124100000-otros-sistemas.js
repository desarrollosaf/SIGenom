'use strict';

/**
 * Movimientos que llegan de otros sistemas (personal, checadores y préstamos). Se leen a esta bandeja y
 * alguien los revisa y aplica; `externo_id` evita traer o aplicar dos veces el mismo.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const t = { transaction };
      const tiempos = { created_at: { type: Sequelize.DATE, allowNull: false }, updated_at: { type: Sequelize.DATE, allowNull: false } };
      await queryInterface.createTable('movimientos_externos', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        sistema: { type: Sequelize.STRING(12), allowNull: false },
        externo_id: { type: Sequelize.STRING(40), allowNull: false },
        lote: { type: Sequelize.STRING(20), allowNull: true },
        tipo: { type: Sequelize.STRING(20), allowNull: false },
        subtipo: { type: Sequelize.STRING(10), allowNull: true },
        curp: { type: Sequelize.STRING(18), allowNull: true },
        rfc: { type: Sequelize.STRING(13), allowNull: true },
        nombre: { type: Sequelize.STRING(170), allowNull: false },
        tipo_nomina: { type: Sequelize.STRING(1), allowNull: true },
        anio: { type: Sequelize.SMALLINT, allowNull: true },
        quincena: { type: Sequelize.SMALLINT, allowNull: true },
        fecha: { type: Sequelize.DATEONLY, allowNull: true },
        datos: { type: Sequelize.JSONB, allowNull: false },
        estado: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'pendiente' },
        mensaje: { type: Sequelize.TEXT, allowNull: true },
        empleado_id: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'empleados', key: 'id' }, onDelete: 'SET NULL' },
        atendido_por: { type: Sequelize.STRING(20), allowNull: true },
        atendido_el: { type: Sequelize.DATE, allowNull: true },
        ...tiempos,
      }, t);
      await queryInterface.addIndex('movimientos_externos', ['sistema', 'externo_id'], { unique: true, ...t });
      await queryInterface.addIndex('movimientos_externos', ['sistema', 'estado'], t);
      await queryInterface.createTable('lecturas_externas', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        sistema: { type: Sequelize.STRING(12), allowNull: false },
        usuario: { type: Sequelize.STRING(20), allowNull: false },
        nuevos: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        error: { type: Sequelize.TEXT, allowNull: true },
        ...tiempos,
      }, t);
      // Para reconocer el mismo préstamo cuando llega su cambio o su liquidación.
      await queryInterface.addColumn('descuentos_plazo', 'referencia_externa', { type: Sequelize.STRING(40), allowNull: true }, t);
      await queryInterface.addIndex('descuentos_plazo', ['referencia_externa'], t);
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const t = { transaction };
      await queryInterface.removeColumn('descuentos_plazo', 'referencia_externa', t);
      await queryInterface.dropTable('lecturas_externas', t);
      await queryInterface.dropTable('movimientos_externos', t);
    });
  },
};
