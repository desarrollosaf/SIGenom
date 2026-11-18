/**
 * Carga en SIGenom las nóminas pagadas por el sistema anterior, a partir de los TXT que genera
 * 1COM-PAGB.W (procedimiento `exporta`): un archivo por quincena y tipo de nómina, p. ej.
 * 2025010115P.TXT (Principal, 1 al 15 de enero) o 20250101_0430P.TXT (pago extraordinario).
 *
 *   npm run importar:txt-legado -- /ruta/TXT_v2                         # revisa, no escribe
 *   npm run importar:txt-legado -- /ruta/TXT_v2 --aplicar               # carga (base sin empleados)
 *   npm run importar:txt-legado -- /ruta/TXT_v2 --aplicar --reemplazar  # borra empleados y nóminas antes
 *
 * Qué deja en la base:
 *   - Empleados (por CURP y tipo de nómina) con los datos de su último recibo, adscripciones y
 *     puestos (con descripción provisional) y las claves de percepción y deducción que aparecen.
 *   - Por cada archivo, un cálculo tipo `legado` con los recibos tal como se pagaron: es la
 *     evidencia para auditoría y la referencia para comparar (npm run comparar:legado).
 *   - Por cada quincena ordinaria, un periodo abierto con las percepciones y deducciones del
 *     sistema anterior como capturas, excepto las que calcula SIGenom (ISR y cuotas ISSEMYM).
 *     Al calcular la quincena, SIGenom vuelve a sacar el ISR y el ISSEMYM sobre esos importes.
 *
 * Los TXT traen CURP, RFC y cuentas bancarias: se cargan solo en la base local, no se guardan en
 * el repositorio.
 *
 * Línea del TXT (EXPORT DELIMITER ";"): tipo, folio, número ISSEMYM, RFC, nombre, CURP, cuenta,
 * fecha desde, fecha hasta, total percepciones, total deducciones, neto, 24 claves y 24 importes
 * de percepciones, 24 claves y 24 importes de deducciones, adscripción, distrito, fecha de alta,
 * sindicato, puesto, rango.
 */
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Sequelize, QueryTypes } = require('sequelize');
const config = require('../migrations-config')[process.env.NODE_ENV ?? 'development'];

/** Claves que SIGenom calcula: no se capturan, se recalculan. 611/612 son el ISSEMYM de los retroactivos. */
const CALCULADAS = new Set([501, 511, 512, 611, 612]);

/**
 * Deducido de los recibos 2025 (no se tiene Cata-pd): las cuotas 511/512 salen exactas sobre la
 * suma de estas percepciones, y el ISR (tarifa mensual sobre el doble de la quincena) sobre estas
 * otras. Los retroactivos (clave + 100: 101, 111… y 611, 612…) se comportan como su clave original.
 */
const COTIZAN_ISSEMYM = new Set([1, 11, 12, 17, 33, 34, 42, 43, 44, 45, 46, 48, 49, 50]);
const GRAVAN_ISR = new Set([1, 11, 12, 17, 27]);
const original = (clave) => ((clave >= 100 && clave < 200) || (clave >= 600 && clave < 700) ? clave - 100 : clave);

const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, OCT: 10, NOV: 11, DIC: 12 };
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'SAN', 'MC', 'VAN', 'VON', 'DA', 'DI']);

/** Progress EXPORT: campos separados por ";", texto entre comillas ("" escapa una comilla), ? es nulo. */
function separar(linea) {
  const campos = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (comillas) {
      if (ch === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (ch === '"') comillas = false;
      else actual += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === ';') { campos.push(actual); actual = ''; }
    else actual += ch;
  }
  campos.push(actual);
  return campos.map((c) => (c === '?' ? '' : c.trim()));
}

const pesos = (v) => Math.round(Number(v || 0) * 100);
const fechaLarga = (t) => {
  const [d, m, a] = t.split('-');
  return `${a}-${String(MESES[m.toUpperCase()]).padStart(2, '0')}-${d.padStart(2, '0')}`;
};
const fechaCorta = (t) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(t ?? '');
  if (!m) return null;
  const anio = Number(m[3]) <= 40 ? 2000 + Number(m[3]) : 1900 + Number(m[3]);
  return `${anio}-${m[2]}-${m[1]}`;
};
const ultimoDia = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/** "PATERNO MATERNO NOMBRES", con apellidos compuestos (DE LA COLINA, DEL VALLE…). */
function partirNombre(nombre) {
  const t = nombre.split(/\s+/).filter(Boolean);
  const apellido = () => {
    const partes = [];
    while (t.length > 1 && PARTICULAS.has(t[0])) partes.push(t.shift());
    if (t.length) partes.push(t.shift());
    return partes.join(' ');
  };
  const paterno = apellido();
  const materno = t.length > 1 ? apellido() : null;
  return { paterno, materno, nombres: t.join(' ') || materno || paterno };
}

function leerArchivo(ruta) {
  const texto = fs.readFileSync(ruta).toString('latin1');
  const recibos = [];
  const errores = [];
  texto.split(/\r?\n/).forEach((linea, i) => {
    if (!linea.trim()) return;
    const c = separar(linea);
    if (c.length < 114) { errores.push(`renglón ${i + 1}: ${c.length} campos, se esperaban 114`); return; }
    const lineas = [];
    for (const [nat, desde] of [['P', 12], ['D', 60]]) {
      for (let k = 0; k < 24; k++) {
        const clave = Number(c[desde + k]);
        const importe = pesos(c[desde + 24 + k]);
        if (c[desde + k] && importe !== 0) lineas.push({ naturaleza: nat, clave, importe });
      }
    }
    const r = {
      tipo: c[0].toUpperCase(),
      folio: Number(c[1]),
      numeroIssemym: Number(c[2]) || null,
      rfc: c[3].replace(/-/g, ''),
      nombre: c[4].replace(/\s+/g, ' '),
      curp: c[5].toUpperCase(),
      cuenta: c[6].replace(/\D/g, '') || null,
      inicio: fechaLarga(c[7]),
      fin: fechaLarga(c[8]),
      tp: pesos(c[9]),
      td: pesos(c[10]),
      neto: pesos(c[11]),
      lineas,
      adscripcion: Number(c[108]),
      distrito: c[109],
      fechaAlta: fechaCorta(c[110]),
      sindicato: c[111],
      puesto: c[112],
      rango: Number(c[113]) || 1,
    };
    const sp = lineas.filter((l) => l.naturaleza === 'P').reduce((s, l) => s + l.importe, 0);
    const sd = lineas.filter((l) => l.naturaleza === 'D').reduce((s, l) => s + l.importe, 0);
    if (sp !== r.tp || sd !== r.td || r.tp - r.td !== r.neto) {
      errores.push(`renglón ${i + 1} (${r.curp}): los importes no suman los totales del recibo`);
    }
    recibos.push(r);
  });
  return { recibos, errores };
}

/** Quincena ordinaria (1-15 o 16-fin de mes) o null si el archivo es un pago extraordinario. */
function quincenaDe(inicio, fin) {
  const [a1, m1, d1] = inicio.split('-').map(Number);
  const [a2, m2, d2] = fin.split('-').map(Number);
  if (a1 !== a2 || m1 !== m2) return null;
  if (d1 === 1 && d2 === 15) return { anio: a1, quincena: m1 * 2 - 1 };
  if (d1 === 16 && d2 === ultimoDia(a2, m2)) return { anio: a1, quincena: m1 * 2 };
  return null;
}

async function insertar(qi, tabla, filas, transaction, returning) {
  const salida = [];
  for (let i = 0; i < filas.length; i += 2000) {
    const r = await qi.bulkInsert(tabla, filas.slice(i, i + 2000), { transaction, ...(returning ? { returning } : {}) });
    if (returning) salida.push(...r);
  }
  return salida;
}

async function main() {
  const carpeta = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  const reemplazar = process.argv.includes('--reemplazar');
  if (!carpeta || !fs.existsSync(carpeta) || !fs.statSync(carpeta).isDirectory()) {
    console.error('Uso: npm run importar:txt-legado -- <carpeta con los TXT> [--aplicar] [--reemplazar]');
    process.exit(1);
  }

  // --- Lectura ---------------------------------------------------------------------------------
  const archivos = fs.readdirSync(carpeta).filter((f) => /^\d{8}_?\d{2,4}[A-Z]\.TXT$/i.test(f)).sort();
  const nominas = [];
  let errores = 0;
  for (const nombre of archivos) {
    const { recibos, errores: e } = leerArchivo(path.join(carpeta, nombre));
    if (e.length) { errores += e.length; console.log(`${nombre}:\n  ${e.slice(0, 5).join('\n  ')}`); }
    if (!recibos.length) continue;
    const { tipo, inicio, fin } = recibos[0];
    nominas.push({ archivo: nombre, tipo, inicio, fin, q: quincenaDe(inicio, fin), recibos });
  }
  if (errores) {
    console.error(`\n${errores} renglones con errores; corrige los archivos antes de cargar.`);
    process.exit(1);
  }
  nominas.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.inicio.localeCompare(b.inicio) || a.fin.localeCompare(b.fin));

  // Empleados: los datos de su último recibo; alta en su primera quincena y baja tras la última.
  const empleados = new Map();
  const ordinarias = nominas.filter((n) => n.q);
  const ultimaPorTipo = new Map();
  for (const n of ordinarias) ultimaPorTipo.set(n.tipo, n);
  for (const n of ordinarias) {
    for (const r of n.recibos) {
      const llave = `${r.tipo}|${r.curp}`;
      let e = empleados.get(llave);
      if (!e) { e = { primera: n, quincenas: [], sci: false }; empleados.set(llave, e); }
      e.ultimo = r;
      e.ultima = n;
      e.quincenas.push(n);
      if (r.lineas.some((l) => l.clave === 549)) e.sci = true;
    }
  }
  for (const n of nominas.filter((x) => !x.q)) {
    for (const r of n.recibos) {
      if (!empleados.has(`${r.tipo}|${r.curp}`)) {
        empleados.set(`${r.tipo}|${r.curp}`, { primera: n, ultima: n, ultimo: r, quincenas: [], sci: false, soloExtra: true });
      }
    }
  }

  const claves = new Map();
  for (const n of nominas) for (const r of n.recibos) for (const l of r.lineas) claves.set(`${n.tipo}|${l.clave}`, l.naturaleza);

  const totalRecibos = nominas.reduce((s, n) => s + n.recibos.length, 0);
  console.log(`${nominas.length} archivos, ${totalRecibos} recibos (${ordinarias.length} quincenas ordinarias y ${nominas.length - ordinarias.length} pagos extraordinarios).`);
  for (const n of nominas) {
    const neto = n.recibos.reduce((s, r) => s + r.neto, 0) / 100;
    console.log(`  ${n.archivo.padEnd(20)} ${n.tipo} ${n.inicio} a ${n.fin} ${n.q ? `Q${String(n.q.quincena).padStart(2, '0')}` : 'extra'} ${String(n.recibos.length).padStart(5)} recibos  neto ${neto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  }
  const bajas = [...empleados.values()].filter((e) => e.ultima !== ultimaPorTipo.get(e.ultimo.tipo)).length;
  console.log(`${empleados.size} empleados (${bajas} ya no cobran en la última quincena), ${claves.size} claves por tipo de nómina.`);

  const db = new Sequelize(config.database, config.username, config.password, { ...config, logging: false });
  const qi = db.getQueryInterface();
  try {
    const [{ total }] = await db.query('SELECT count(*)::int total FROM empleados', { type: QueryTypes.SELECT });
    if (total > 0 && !reemplazar) {
      console.log(`\nLa base ya tiene ${total} empleados. Usa --reemplazar para borrarlos (con sus quincenas y cálculos) antes de cargar.`);
      if (aplicar) process.exit(1);
    }
    if (!aplicar) {
      console.log('\nNo se escribió nada. Repite con --aplicar para cargar.');
      return;
    }

    const ahora = new Date();
    const t = { created_at: ahora, updated_at: ahora };
    await db.transaction(async (transaction) => {
      const sql = (q, replacements) => db.query(q, { replacements, transaction });
      if (reemplazar) {
        for (const tabla of ['recibo_conceptos', 'recibos', 'calculos', 'capturas', 'periodos', 'movimientos_personal', 'cuentas_contables',
          'descuentos_plazo', 'empleado_conceptos', 'datos_personales', 'sucursales_bancarias', 'empleados', 'tabulador', 'puestos', 'adscripciones']) {
          await sql(`DELETE FROM ${tabla}`);
        }
      }

      // --- Catálogos -----------------------------------------------------------------------------
      const ads = new Set([...empleados.values()].map((e) => e.ultimo.adscripcion));
      for (const n of nominas) for (const r of n.recibos) ads.add(r.adscripcion);
      for (const id of ads) {
        await sql(`INSERT INTO adscripciones (id, descripcion, area_presupuestal, activo, created_at, updated_at)
                   VALUES (:id, :d, NULL, true, now(), now()) ON CONFLICT (id) DO NOTHING`, { id, d: `ADSCRIPCIÓN ${id}` });
      }
      const puestos = new Set();
      for (const n of nominas) for (const r of n.recibos) puestos.add(r.puesto || 'SIN-PUESTO');
      for (const clave of puestos) {
        await sql(`INSERT INTO puestos (clave, descripcion, activo, created_at, updated_at)
                   VALUES (:clave, :d, true, now(), now()) ON CONFLICT (clave) DO NOTHING`, { clave, d: `PUESTO ${clave}` });
      }
      // El sueldo (001) y la gratificación (012) vienen del sistema anterior como capturas; el nivel 0
      // con importes en cero evita que SIGenom los vuelva a sumar desde el tabulador.
      const rangos = new Set([...empleados.values()].map((e) => e.ultimo.rango));
      for (const rango of rangos) {
        await sql(`INSERT INTO tabulador (nivel, rango, sueldo_mensual, compensacion_mensual, created_at, updated_at)
                   VALUES (0, :rango, 0, 0, now(), now()) ON CONFLICT (nivel, rango) DO NOTHING`, { rango });
      }

      const existentes = await db.query('SELECT tipo_nomina, clave, descripcion FROM conceptos', { type: QueryTypes.SELECT, transaction });
      const descripcion = new Map(existentes.map((c) => [`${c.tipo_nomina}|${c.clave}`, c.descripcion]));
      // Primero las claves originales, para que el retroactivo tome su descripción.
      const ordenadas = [...claves].sort(([a], [b]) => Number(a.split('|')[1]) - Number(b.split('|')[1]));
      for (const [llave, naturaleza] of ordenadas) {
        const [tipo, texto] = llave.split('|');
        const clave = Number(texto);
        const base = descripcion.get(`${tipo}|${original(clave)}`);
        const actual = descripcion.get(llave);
        const provisional = !actual || actual.startsWith('CLAVE ');
        const desc = !provisional ? actual : clave !== original(clave) && base && !base.startsWith('CLAVE ') ? `RETRO ${base}`.slice(0, 60) : `CLAVE ${String(clave).padStart(3, '0')}`;
        descripcion.set(llave, desc);
        await sql(`INSERT INTO conceptos (tipo_nomina, clave, abreviatura, descripcion, naturaleza, periodicidad, grava_isr,
                                          factor_issemym, partida, clave_issemym, calculado, activo, created_at, updated_at)
                   VALUES (:tipo, :clave, :abrev, :desc, :naturaleza, 'F', :grava, :factor, NULL, NULL, NULL, true, now(), now())
                   ON CONFLICT (tipo_nomina, clave) DO UPDATE SET grava_isr = EXCLUDED.grava_isr,
                     descripcion = EXCLUDED.descripcion, abreviatura = EXCLUDED.abreviatura,
                     factor_issemym = EXCLUDED.factor_issemym, activo = true, updated_at = now()`, {
          tipo, clave, naturaleza, desc, abrev: desc.slice(0, 12),
          grava: naturaleza === 'P' && GRAVAN_ISR.has(original(clave)),
          factor: naturaleza === 'P' && COTIZAN_ISSEMYM.has(original(clave)) ? 1 : 0,
        });
      }
      const conceptos = await db.query('SELECT id, tipo_nomina, clave, descripcion, naturaleza, grava_isr, partida FROM conceptos',
        { type: QueryTypes.SELECT, transaction });
      const concepto = new Map(conceptos.map((c) => [`${c.tipo_nomina}|${c.clave}`, c]));

      // --- Empleados -----------------------------------------------------------------------------
      const filas = [...empleados.entries()].map(([, e]) => {
        const r = e.ultimo;
        const nombre = partirNombre(r.nombre);
        const ultimaDelTipo = ultimaPorTipo.get(r.tipo);
        const baja = e.soloExtra || e.ultima !== ultimaDelTipo ? e.ultima.fin : null;
        return {
          curp: r.curp, rfc: r.rfc,
          apellido_paterno: nombre.paterno.slice(0, 50), apellido_materno: nombre.materno?.slice(0, 50) ?? null, nombres: nombre.nombres.slice(0, 60),
          tipo_nomina: r.tipo, adscripcion_id: r.adscripcion, puesto_clave: r.puesto || 'SIN-PUESTO', nivel: 0, rango: r.rango,
          numero_issemym: r.numeroIssemym, sindicalizado: false, sci: e.sci,
          estado: baja ? 'baja' : 'activo', fecha_alta: e.primera.inicio, fecha_baja: baja,
          fecha_ingreso_gobierno: r.fechaAlta, banco: null, cuenta_bancaria: r.cuenta, pago_cheque: !r.cuenta, ...t,
        };
      });
      const creados = await insertar(qi, 'empleados', filas, transaction, ['id', 'curp', 'tipo_nomina']);
      const idEmpleado = new Map(creados.map((c) => [`${c.tipo_nomina}|${c.curp}`, c.id]));

      await insertar(qi, 'datos_personales', [...empleados.entries()].map(([llave, e]) => ({
        empleado_id: idEmpleado.get(llave),
        observaciones: `Sistema anterior: distrito "${e.ultimo.distrito}", sindicato "${e.ultimo.sindicato}", alta ${e.ultimo.fechaAlta ?? '?'}.`,
        ...t,
      })), transaction);

      // Movimientos: alta, baja y un permiso por cada quincena sin pago entre la primera y la última.
      const movimientos = [];
      for (const [llave, e] of empleados) {
        const id = idEmpleado.get(llave);
        movimientos.push({ empleado_id: id, tipo: 'alta', fecha_inicio: e.primera.inicio, registrado_por: 'LEGADO', cancelado: false, observaciones: 'Primera quincena pagada en los TXT del sistema anterior.', ...t });
        const cobradas = new Set(e.quincenas);
        const delTipo = ordinarias.filter((n) => n.tipo === e.ultimo.tipo && n.inicio >= e.primera.inicio && n.fin <= e.ultima.fin);
        for (const n of delTipo) {
          if (!cobradas.has(n)) movimientos.push({ empleado_id: id, tipo: 'permiso', motivo_clave: 'P01', fecha_inicio: n.inicio, fecha_fin: n.fin, registrado_por: 'LEGADO', cancelado: false, observaciones: `Sin pago en ${n.archivo}.`, ...t });
        }
        const baja = filas.find((f) => f.tipo_nomina === e.ultimo.tipo && f.curp === e.ultimo.curp).fecha_baja;
        if (baja) movimientos.push({ empleado_id: id, tipo: 'baja', fecha_inicio: baja, registrado_por: 'LEGADO', cancelado: false, observaciones: 'Último pago en los TXT del sistema anterior.', ...t });
      }
      await insertar(qi, 'movimientos_personal', movimientos.map((m) => ({ motivo_clave: null, fecha_fin: null, ...m })), transaction);

      // --- Quincenas, recibos pagados y capturas -------------------------------------------------
      const periodos = new Map();
      for (const n of ordinarias) {
        const [p] = await insertar(qi, 'periodos', [{
          tipo_nomina: n.tipo, anio: n.q.anio, quincena: n.q.quincena, fecha_inicio: n.inicio, fecha_fin: n.fin, fecha_pago: n.fin, estado: 'captura', ...t,
        }], transaction, ['id']);
        periodos.set(`${n.tipo}|${n.fin}`, p.id);
      }

      let capturas = 0;
      for (const n of nominas) {
        // Los extraordinarios se guardan en la quincena en que termina su periodo.
        const periodoId = periodos.get(`${n.tipo}|${n.fin}`)
          ?? periodos.get([...periodos.keys()].filter((k) => k.startsWith(`${n.tipo}|`) && k.slice(2) <= n.fin).pop());
        const suma = (campo) => n.recibos.reduce((s, r) => s + r[campo], 0) / 100;
        const [calculo] = await insertar(qi, 'calculos', [{
          periodo_id: periodoId, tipo: 'legado', estado: 'terminado', total_empleados: n.recibos.length, procesados: n.recibos.length,
          total_percepciones: suma('tp'), total_deducciones: suma('td'), total_neto: suma('neto'),
          error: n.q ? null : `Pago extraordinario ${n.inicio} a ${n.fin} (${n.archivo})`,
          solicitado_por: `LEGADO ${n.archivo.replace(/\.TXT$/i, '')}`.slice(0, 20), iniciado_el: ahora, terminado_el: ahora, ...t,
        }], transaction, ['id']);

        const recibos = await insertar(qi, 'recibos', n.recibos.map((r) => {
          const p = r.lineas.filter((l) => l.naturaleza === 'P');
          return {
            calculo_id: calculo.id, empleado_id: idEmpleado.get(`${r.tipo}|${r.curp}`), nombre: r.nombre, curp: r.curp, rfc: r.rfc,
            adscripcion_id: r.adscripcion, puesto_clave: r.puesto || 'SIN-PUESTO', nivel: 0, rango: r.rango, dias: n.q ? 15 : 0,
            base_isr: p.filter((l) => GRAVAN_ISR.has(original(l.clave))).reduce((s, l) => s + l.importe, 0) / 100,
            base_issemym: p.filter((l) => COTIZAN_ISSEMYM.has(original(l.clave))).reduce((s, l) => s + l.importe, 0) / 100,
            isr_causado: (r.lineas.find((l) => l.clave === 501)?.importe ?? 0) / 100, subsidio: 0,
            total_percepciones: r.tp / 100, total_deducciones: r.td / 100, neto: r.neto / 100,
            cuenta_bancaria: r.cuenta, pago_cheque: !r.cuenta,
            observaciones: JSON.stringify([`Pagado por el sistema anterior: ${n.archivo}, folio ${r.folio}.`]), created_at: ahora,
          };
        }), transaction, ['id', 'empleado_id']);
        const idRecibo = new Map(recibos.map((x) => [x.empleado_id, x.id]));

        const conceptosRecibo = [];
        const capturasQuincena = [];
        for (const r of n.recibos) {
          const empleadoId = idEmpleado.get(`${r.tipo}|${r.curp}`);
          for (const l of r.lineas) {
            const c = concepto.get(`${r.tipo}|${l.clave}`);
            conceptosRecibo.push({
              recibo_id: idRecibo.get(empleadoId), concepto_id: c.id, clave: l.clave, descripcion: c.descripcion, naturaleza: l.naturaleza,
              importe: l.importe / 100, gravado_isr: l.naturaleza === 'P' && c.grava_isr ? l.importe / 100 : 0, partida: c.partida,
            });
            if (n.q && !CALCULADAS.has(l.clave)) {
              capturasQuincena.push({
                periodo_id: periodoId, empleado_id: empleadoId, concepto_id: c.id, importe: l.importe / 100,
                origen: 'legado', referencia: `${n.archivo} folio ${r.folio}`, registrado_por: 'LEGADO', ...t,
              });
            }
          }
        }
        await insertar(qi, 'recibo_conceptos', conceptosRecibo, transaction);
        await insertar(qi, 'capturas', capturasQuincena, transaction);
        capturas += capturasQuincena.length;
        process.stdout.write(`  ${n.archivo} cargado\n`);
      }
      console.log(`\nListo: ${empleados.size} empleados, ${periodos.size} quincenas abiertas, ${totalRecibos} recibos del sistema anterior y ${capturas} capturas.`);
    });
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
