/**
 * Carga el catálogo de percepciones y deducciones del sistema anterior (Cata-pd) en `conceptos`,
 * con las mismas claves. El CSV sale de docs/legado/EXPORTA-CATA-PD.P.
 *
 *   npm run importar:cata-pd -- /ruta/cata-pd.csv            # muestra lo que haría, no escribe
 *   npm run importar:cata-pd -- /ruta/cata-pd.csv --aplicar  # escribe
 *
 * Inserta o actualiza por (tipo de nómina, clave). Respeta `calculado` y `activo` de las claves que
 * ya existían, porque eso lo decide SIGenom (qué concepto es el sueldo, el ISR…), no Cata-pd.
 * Al final lista las claves de SIGenom que no vienen en Cata-pd, para revisarlas a mano.
 */
require('dotenv').config();
const fs = require('node:fs');
const { Sequelize, QueryTypes } = require('sequelize');
const config = require('../migrations-config')[process.env.NODE_ENV ?? 'development'];

const COLUMNAS = ['tipo', 'cves', 'cve-desc', 'cve-des-l', 'per-ded', 'fija-even', 'g-ispt', 'g-issem', 'g-med', 'ded-iss', 'part', 'cve-iss', 'des-pro'];

/** Progress EXPORT: campos separados por coma, texto entre comillas ("" escapa una comilla), ? es nulo. */
function separar(linea) {
  const campos = [];
  let actual = '';
  let comillas = false;
  let entrecomillado = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (comillas) {
      if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (ch === '"') comillas = false;
      else actual += ch;
    } else if (ch === '"') { comillas = true; entrecomillado = true; }
    else if (ch === ',') { campos.push(entrecomillado ? actual : actual.trim()); actual = ''; entrecomillado = false; }
    else actual += ch;
  }
  campos.push(entrecomillado ? actual : actual.trim());
  return campos.map((c) => (c === '?' ? null : c));
}

function leer(ruta) {
  const buffer = fs.readFileSync(ruta);
  // Progress en Windows escribe en latin1; si el archivo ya viene en UTF-8 se respeta.
  const utf8 = buffer.toString('utf8');
  const texto = utf8.includes('�') ? buffer.toString('latin1') : utf8;
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const primera = separar(lineas[0]);
  const conEncabezado = primera[1] === 'cves';
  return (conEncabezado ? lineas.slice(1) : lineas).map((linea, i) => {
    const valores = separar(linea);
    const fila = Object.fromEntries(COLUMNAS.map((c, j) => [c, valores[j] ?? null]));
    fila.renglon = i + (conEncabezado ? 2 : 1);
    return fila;
  });
}

const numero = (v) => (v == null || v === '' ? 0 : Number(String(v).replace(',', '.')));
const texto = (v) => (v ?? '').trim();

function aConcepto(f) {
  const clave = Math.trunc(numero(f.cves));
  const descripcion = (texto(f['cve-desc']) || texto(f['cve-des-l']) || `CLAVE ${clave}`).slice(0, 60);
  const perDed = texto(f['per-ded']).toUpperCase();
  const naturaleza = perDed === 'P' || perDed === 'D' ? perDed : clave < 500 ? 'P' : 'D';
  const claveGem = Math.trunc(numero(f['cve-iss']));
  const partida = Math.trunc(numero(f.part));
  return {
    tipo_nomina: texto(f.tipo).toUpperCase(),
    clave,
    abreviatura: descripcion.slice(0, 12),
    descripcion,
    naturaleza,
    periodicidad: texto(f['fija-even']).toUpperCase() === 'E' ? 'E' : 'F',
    grava_isr: naturaleza === 'P' && texto(f['g-ispt']).toUpperCase() === 'S',
    // En Cata-pd g-issem / g-med traen el porcentaje; para las percepciones solo importa si cotizan.
    factor_issemym: naturaleza === 'P' && (numero(f['g-issem']) > 0 || numero(f['g-med']) > 0) ? 1 : 0,
    partida: partida > 0 ? String(partida) : null,
    clave_issemym: claveGem > 0 ? claveGem : null,
  };
}

async function main() {
  const ruta = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!ruta || !fs.existsSync(ruta)) {
    console.error('Uso: npm run importar:cata-pd -- <cata-pd.csv> [--aplicar]');
    process.exit(1);
  }

  const errores = [];
  const conceptos = [];
  for (const fila of leer(ruta)) {
    const c = aConcepto(fila);
    if (!c.tipo_nomina || !Number.isFinite(c.clave) || c.clave <= 0 || c.clave > 32767) {
      errores.push(`renglón ${fila.renglon}: tipo "${fila.tipo}" clave "${fila.cves}" no válidos`);
      continue;
    }
    conceptos.push(c);
  }

  const db = new Sequelize(config.database, config.username, config.password, { ...config, logging: false });
  try {
    const tipos = new Set((await db.query('SELECT clave FROM tipos_nomina', { type: QueryTypes.SELECT })).map((t) => t.clave));
    const existentes = await db.query('SELECT id, tipo_nomina, clave, descripcion FROM conceptos', { type: QueryTypes.SELECT });
    const llave = (t, c) => `${t}-${c}`;
    const yaEstan = new Map(existentes.map((e) => [llave(e.tipo_nomina, e.clave), e]));

    const validos = conceptos.filter((c) => {
      if (tipos.has(c.tipo_nomina)) return true;
      errores.push(`clave ${c.clave}: tipo de nómina "${c.tipo_nomina}" no existe en SIGenom`);
      return false;
    });
    const nuevos = validos.filter((c) => !yaEstan.has(llave(c.tipo_nomina, c.clave)));
    const cambian = validos.filter((c) => yaEstan.has(llave(c.tipo_nomina, c.clave)));
    const enArchivo = new Set(validos.map((c) => llave(c.tipo_nomina, c.clave)));
    const sobran = existentes.filter((e) => !enArchivo.has(llave(e.tipo_nomina, e.clave)));

    console.log(`Cata-pd: ${validos.length} claves (${nuevos.length} nuevas, ${cambian.length} se actualizan)`);
    for (const c of cambian) {
      const antes = yaEstan.get(llave(c.tipo_nomina, c.clave));
      if (antes.descripcion !== c.descripcion) console.log(`  ${c.tipo_nomina} ${String(c.clave).padStart(3, '0')}: "${antes.descripcion}" → "${c.descripcion}"`);
    }
    if (sobran.length) {
      console.log(`\nEn SIGenom pero no en Cata-pd (revisar; no se tocan):`);
      for (const e of sobran) console.log(`  ${e.tipo_nomina} ${String(e.clave).padStart(3, '0')} ${e.descripcion}`);
    }
    if (errores.length) {
      console.log(`\nRenglones omitidos:`);
      for (const e of errores) console.log(`  ${e}`);
    }

    if (!aplicar) {
      console.log('\nNo se escribió nada. Repite con --aplicar para cargar el catálogo.');
      return;
    }
    await db.transaction(async (transaction) => {
      for (const c of validos) {
        await db.query(
          `INSERT INTO conceptos (tipo_nomina, clave, abreviatura, descripcion, naturaleza, periodicidad, grava_isr,
                                  factor_issemym, partida, clave_issemym, calculado, activo, created_at, updated_at)
           VALUES (:tipo_nomina, :clave, :abreviatura, :descripcion, :naturaleza, :periodicidad, :grava_isr,
                   :factor_issemym, :partida, :clave_issemym, NULL, true, now(), now())
           ON CONFLICT (tipo_nomina, clave) DO UPDATE SET
             abreviatura = EXCLUDED.abreviatura, descripcion = EXCLUDED.descripcion, naturaleza = EXCLUDED.naturaleza,
             periodicidad = EXCLUDED.periodicidad, grava_isr = EXCLUDED.grava_isr, factor_issemym = EXCLUDED.factor_issemym,
             partida = EXCLUDED.partida, clave_issemym = EXCLUDED.clave_issemym, updated_at = now()`,
          { replacements: c, transaction },
        );
      }
    });
    console.log(`\nListo: ${validos.length} claves cargadas.`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
