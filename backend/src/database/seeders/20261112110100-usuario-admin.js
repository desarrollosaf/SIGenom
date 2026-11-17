'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');

/** El primer administrador, con los datos de SEED_ADMIN_USUARIO y SEED_ADMIN_PASSWORD. */
/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    const usuario = (process.env.SEED_ADMIN_USUARIO || 'ADMIN').trim().toUpperCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!password || password.length < 8) {
      throw new Error('Define SEED_ADMIN_PASSWORD (8 caracteres o más) en backend/.env antes de correr el seed.');
    }
    const ahora = new Date();
    await queryInterface.bulkInsert(
      'usuarios',
      [{ usuario, nombre: 'Administrador', password_hash: await bcrypt.hash(password, 10), rol: 'administrador', activo: true, created_at: ahora, updated_at: ahora }],
      { ignoreDuplicates: true },
    );
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('usuarios', { usuario: (process.env.SEED_ADMIN_USUARIO || 'ADMIN').toUpperCase() });
  },
};
