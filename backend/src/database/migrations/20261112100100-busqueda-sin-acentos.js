'use strict';

/**
 * Búsqueda de personas sin importar acentos: "garcia" encuentra "García". `unaccent` viene con
 * PostgreSQL. Sin índice: un LIKE '%texto%' no lo usaría y la plantilla es de unos miles de
 * personas; si algún día crece mucho, el camino es pg_trgm.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE EXTENSION IF NOT EXISTS unaccent;
      CREATE OR REPLACE FUNCTION sin_acentos(texto text) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(public.unaccent('public.unaccent', coalesce(texto, ''))) $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP FUNCTION IF EXISTS sin_acentos(text);
    `);
  },
};
