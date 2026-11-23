/**
 * Carga la tabla-rang del sistema anterior (tabulador de sueldos) como una vigencia del tabulador.
 * Cada aumento trae una tabla nueva: se carga con la fecha desde la que vale y las anteriores se
 * conservan, así cada quincena se calcula (y se audita) con la que estaba vigente.
 *
 *   npm run importar:tabla-rang -- TABLA-RANG.csv --vigencia 2025-01-01            # revisa, no escribe
 *   npm run importar:tabla-rang -- TABLA-RANG.csv --vigencia 2025-01-01 --aplicar
 *
 * El CSV es la hoja de Excel guardada como CSV (separada por ";", decimales con coma):
 *   NIVEL;IMP-NIVEL;IMP-RAN-1..5;IMP-COMP-1..5   (importes QUINCENALES)
 * Comprobado contra los recibos 2025: 001 sueldo = IMP-NIVEL, 012 gratificación = IMP-RAN del rango
 * del empleado y 011 compensación = IMP-COMP del rango. SIGenom guarda importes mensuales (el doble).
 * El renglón del nivel 0 no es un nivel (trae 3500; 1..5; 0.5..2.5) y no se carga.
 * También acepta el tabla-rang.txt que dejaba el respaldo de cada quincena (ver leerRespaldo).
 */
require('dotenv').config();
const fs = require('node:fs');
const { Sequelize, QueryTypes } = require('sequelize');
const config = require('../migrations-config')[process.env.NODE_ENV ?? 'development'];

const arg = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
/** La hoja trae decimales con coma (4179,1) y sin separador de miles. */
const numero = (t) => Number(String(t ?? '').trim().replace(',', '.'));
const pesos = (n) => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Respaldo de quincena del sistema anterior (RESP.W: B:\NDHPaaaa\QNAqqaa\tabla-rang.txt): sin
 * encabezado, separado por espacios y con punto decimal, en el orden de la tabla:
 * nivel imp-nivel imp-rang[1..5] imp-comp[1..5].
 */
function leerRespaldo(lineas) {
  const filas = [];
  for (const linea of lineas) {
    const v = linea.trim().split(/\s+/).map(Number);
    const nivel = v[0];
    if (!Number.isInteger(nivel) || nivel <= 0 || v.length < 12) continue;
    for (let rango = 1; rango <= 5; rango++) {
      filas.push({ nivel, rango, sueldoQ: v[1], gratificacionQ: v[1 + rango] || 0, compensacionQ: v[6 + rango] || 0 });
    }
  }
  return filas;
}

function leer(ruta) {
  const lineas = fs.readFileSync(ruta).toString('latin1').split(/\r?\n/).filter((l) => l.trim());
  if (!/NIVEL/i.test(lineas[0])) return leerRespaldo(lineas);
  const delimitador = lineas[0].includes(';') ? ';' : ',';
  const encabezado = lineas[0].split(delimitador).map((c) => c.trim().toUpperCase());
  const col = (nombre) => encabezado.indexOf(nombre);
  for (const c of ['NIVEL', 'IMP-NIVEL', 'IMP-RAN-1', 'IMP-COMP-1']) {
    if (col(c) < 0) throw new Error(`Falta la columna ${c}. Encabezados: ${encabezado.join(', ')}`);
  }
  const rangos = encabezado.filter((c) => /^IMP-RAN-\d+$/.test(c)).map((c) => Number(c.split('-')[2]));
  const filas = [];
  for (const linea of lineas.slice(1)) {
    const v = linea.split(delimitador);
    const nivel = numero(v[col('NIVEL')]);
    if (!Number.isInteger(nivel) || nivel <= 0) continue;
    const sueldo = numero(v[col('IMP-NIVEL')]);
    for (const rango of rangos) {
      const gratificacion = numero(v[col(`IMP-RAN-${rango}`)]) || 0;
      const compensacion = col(`IMP-COMP-${rango}`) >= 0 ? numero(v[col(`IMP-COMP-${rango}`)]) || 0 : 0;
      filas.push({ nivel, rango, sueldoQ: sueldo, gratificacionQ: gratificacion, compensacionQ: compensacion });
    }
  }
  return filas;
}

async function main() {
  const ruta = process.argv[2];
  const vigencia = arg('vigencia');
  const aplicar = process.argv.includes('--aplicar');
  if (!ruta || !fs.existsSync(ruta) || !/^\d{4}-\d{2}-\d{2}$/.test(vigencia ?? '')) {
    console.error('Uso: npm run importar:tabla-rang -- <TABLA-RANG.csv> --vigencia AAAA-MM-DD [--aplicar]');
    process.exit(1);
  }
  const filas = leer(ruta);
  const niveles = new Set(filas.map((f) => f.nivel));
  console.log(`Tabla-rang: ${niveles.size} niveles, ${filas.length} renglones nivel-rango, vigente desde ${vigencia}.`);

  const db = new Sequelize(config.database, config.username, config.password, { ...config, logging: false });
  try {
    // Lo que estaba vigente justo antes, para ver cuánto cambia.
    const anteriores = await db.query(
      `SELECT DISTINCT ON (nivel, rango) nivel, rango, vigencia, sueldo_mensual::float s, gratificacion_mensual::float g, compensacion_mensual::float c
       FROM tabulador WHERE vigencia < :vigencia ORDER BY nivel, rango, vigencia DESC`,
      { replacements: { vigencia }, type: QueryTypes.SELECT },
    );
    const previo = new Map(anteriores.map((a) => [`${a.nivel}-${a.rango}`, a]));
    let cambian = 0;
    let nuevos = 0;
    for (const f of filas) {
      const a = previo.get(`${f.nivel}-${f.rango}`);
      if (!a) nuevos++;
      else if (a.s !== f.sueldoQ * 2 || a.g !== f.gratificacionQ * 2 || a.c !== f.compensacionQ * 2) cambian++;
    }
    console.log(`Contra la vigencia anterior: ${nuevos} renglones nuevos, ${cambian} cambian, ${filas.length - nuevos - cambian} iguales.`);
    console.log('\nEjemplo (quincenal):  nivel rango   sueldo 001   gratif. 012   compens. 011');
    for (const f of filas.filter((x) => x.nivel % 6 === 5 && x.rango === 4)) {
      console.log(`                      ${String(f.nivel).padStart(5)} ${String(f.rango).padStart(5)} ${pesos(f.sueldoQ).padStart(12)} ${pesos(f.gratificacionQ).padStart(13)} ${pesos(f.compensacionQ).padStart(14)}`);
    }
    if (!aplicar) {
      console.log('\nNo se escribió nada. Repite con --aplicar para cargarla.');
      return;
    }
    await db.transaction(async (transaction) => {
      for (const f of filas) {
        await db.query(
          `INSERT INTO tabulador (vigencia, nivel, rango, sueldo_mensual, gratificacion_mensual, compensacion_mensual, created_at, updated_at)
           VALUES (:vigencia, :nivel, :rango, :s, :g, :c, now(), now())
           ON CONFLICT (vigencia, nivel, rango) DO UPDATE SET sueldo_mensual = EXCLUDED.sueldo_mensual,
             gratificacion_mensual = EXCLUDED.gratificacion_mensual, compensacion_mensual = EXCLUDED.compensacion_mensual, updated_at = now()`,
          { replacements: { vigencia, nivel: f.nivel, rango: f.rango, s: f.sueldoQ * 2, g: f.gratificacionQ * 2, c: f.compensacionQ * 2 }, transaction },
        );
      }
      // Queda en la bitácora, como lo que se hace desde las pantallas.
      await db.query(
        `INSERT INTO bitacora (usuario, entidad, entidad_id, accion, despues, created_at) VALUES ('SCRIPT', 'tabulador', NULL, 'importa_tabla_rang', CAST(:despues AS jsonb), now())`,
        { replacements: { despues: JSON.stringify({ archivo: require('node:path').basename(ruta), vigencia, renglones: filas.length }) }, transaction },
      );
    });
    console.log(`\nListo: ${filas.length} renglones con vigencia ${vigencia}.`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
