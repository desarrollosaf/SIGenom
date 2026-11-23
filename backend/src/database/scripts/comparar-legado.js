/**
 * Compara, quincena por quincena, lo que pagó el sistema anterior (cálculo `legado`, cargado con
 * importar:txt-legado) contra el último cálculo de SIGenom de la misma quincena (nómina o prenómina).
 *
 *   npm run comparar:legado                               # todas las quincenas calculadas en SIGenom
 *   npm run comparar:legado -- --tipo P --quincena 1      # una quincena (año: el más reciente)
 *   npm run comparar:legado -- --tipo P --quincena 1 --csv /tmp/q01.csv   # detalle por empleado y clave
 *
 * Muestra por clave cuántos recibos difieren y cuánto, y los empleados con más diferencia en el neto.
 */
require('dotenv').config();
const fs = require('node:fs');
const { Sequelize, QueryTypes } = require('sequelize');
const config = require('../migrations-config')[process.env.NODE_ENV ?? 'development'];

const arg = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dinero = (c) => (c / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const col = (t, n) => String(t).padStart(n);

async function main() {
  const db = new Sequelize(config.database, config.username, config.password, { ...config, logging: false });
  const q = (sql, replacements) => db.query(sql, { replacements, type: QueryTypes.SELECT });
  try {
    const filtros = { tipo: arg('tipo')?.toUpperCase() ?? null, quincena: arg('quincena') ? Number(arg('quincena')) : null, anio: arg('anio') ? Number(arg('anio')) : null };
    const pares = await q(`
      SELECT p.id, p.tipo_nomina, p.anio, p.quincena,
        (SELECT id FROM calculos WHERE periodo_id = p.id AND tipo = 'legado' AND error IS NULL ORDER BY id DESC LIMIT 1) legado,
        (SELECT id FROM calculos WHERE periodo_id = p.id AND tipo IN ('nomina', 'prenomina') AND estado = 'terminado'
          ORDER BY (tipo = 'nomina') DESC, id DESC LIMIT 1) nuevo
      FROM periodos p
      WHERE (CAST(:tipo AS text) IS NULL OR p.tipo_nomina = :tipo) AND (CAST(:quincena AS int) IS NULL OR p.quincena = :quincena)
        AND (CAST(:anio AS int) IS NULL OR p.anio = :anio)
      ORDER BY p.tipo_nomina, p.anio, p.quincena`, filtros);
    const listos = pares.filter((p) => p.legado && p.nuevo);
    if (!listos.length) {
      console.log('No hay quincenas con recibos del sistema anterior y un cálculo terminado de SIGenom.');
      return;
    }

    const csv = arg('csv') ? ['tipo;anio;quincena;curp;nombre;clave;descripcion;anterior;sigenom;diferencia'] : null;
    for (const p of listos) {
      const lineas = await q(`
        SELECT r.calculo_id, r.empleado_id, r.curp, r.nombre, rc.clave, rc.descripcion, rc.naturaleza,
               round(sum(rc.importe) * 100)::bigint centavos
        FROM recibos r JOIN recibo_conceptos rc ON rc.recibo_id = r.id
        WHERE r.calculo_id IN (:legado, :nuevo)
        GROUP BY 1, 2, 3, 4, 5, 6, 7`, p);
      const netos = await q(`SELECT calculo_id, empleado_id, round(neto * 100)::bigint neto FROM recibos WHERE calculo_id IN (:legado, :nuevo)`, p);

      const viejo = new Map();
      const nuevo = new Map();
      for (const n of netos) (n.calculo_id === p.legado ? viejo : nuevo).set(n.empleado_id, Number(n.neto));
      const porClave = new Map();
      const empleado = new Map();
      for (const l of lineas) {
        const llave = `${l.empleado_id}|${l.clave}`;
        const d = porClave.get(llave) ?? { empleadoId: l.empleado_id, curp: l.curp, nombre: l.nombre, clave: l.clave, descripcion: l.descripcion, naturaleza: l.naturaleza, viejo: 0, nuevo: 0 };
        d[l.calculo_id === p.legado ? 'viejo' : 'nuevo'] += Number(l.centavos);
        porClave.set(llave, d);
        empleado.set(l.empleado_id, l);
      }

      const ambos = [...viejo.keys()].filter((id) => nuevo.has(id));
      const soloViejo = [...viejo.keys()].filter((id) => !nuevo.has(id)).length;
      const soloNuevo = [...nuevo.entries()].filter(([id, neto]) => !viejo.has(id) && neto !== 0).length;
      const iguales = ambos.filter((id) => viejo.get(id) === nuevo.get(id)).length;
      const sumaV = ambos.reduce((s, id) => s + viejo.get(id), 0);
      const sumaN = ambos.reduce((s, id) => s + nuevo.get(id), 0);

      console.log(`\n=== Nómina ${p.tipo_nomina} ${p.anio} Q${String(p.quincena).padStart(2, '0')}  (anterior: cálculo ${p.legado}, SIGenom: cálculo ${p.nuevo})`);
      console.log(`Recibos en ambos: ${ambos.length}   neto idéntico: ${iguales} (${ambos.length ? ((iguales * 100) / ambos.length).toFixed(2) : 0} %)   solo en el anterior: ${soloViejo}   solo en SIGenom (con importe): ${soloNuevo}`);
      console.log(`Neto anterior ${dinero(sumaV)}   SIGenom ${dinero(sumaN)}   diferencia ${dinero(sumaN - sumaV)}`);

      const resumen = new Map();
      for (const d of porClave.values()) {
        if (!viejo.has(d.empleadoId) || !nuevo.has(d.empleadoId)) continue;
        const r = resumen.get(d.clave) ?? { clave: d.clave, descripcion: d.descripcion, naturaleza: d.naturaleza, recibos: 0, distintos: 0, viejo: 0, nuevo: 0 };
        r.recibos++;
        r.viejo += d.viejo;
        r.nuevo += d.nuevo;
        if (d.viejo !== d.nuevo) r.distintos++;
        resumen.set(d.clave, r);
        if (csv && d.viejo !== d.nuevo) {
          csv.push([p.tipo_nomina, p.anio, p.quincena, d.curp, d.nombre, d.clave, d.descripcion, d.viejo / 100, d.nuevo / 100, (d.nuevo - d.viejo) / 100].join(';'));
        }
      }
      const distintas = [...resumen.values()].filter((r) => r.distintos > 0).sort((a, b) => Math.abs(b.nuevo - b.viejo) - Math.abs(a.nuevo - a.viejo));
      if (distintas.length) {
        console.log(`\n  Clave Descripción               Recibos Distintos       Anterior        SIGenom     Diferencia`);
        for (const r of distintas) {
          console.log(`  ${r.naturaleza} ${String(r.clave).padStart(3, '0')} ${r.descripcion.slice(0, 24).padEnd(24)} ${col(r.recibos, 7)} ${col(r.distintos, 9)} ${col(dinero(r.viejo), 14)} ${col(dinero(r.nuevo), 14)} ${col(dinero(r.nuevo - r.viejo), 14)}`);
        }
      }
      const peores = ambos.map((id) => ({ id, d: nuevo.get(id) - viejo.get(id) })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5);
      if (peores.length) {
        console.log('\n  Mayores diferencias de neto:');
        for (const x of peores) {
          const e = empleado.get(x.id);
          console.log(`    ${e.curp} ${e.nombre.slice(0, 34).padEnd(34)} anterior ${col(dinero(viejo.get(x.id)), 12)}  SIGenom ${col(dinero(nuevo.get(x.id)), 12)}  ${col(dinero(x.d), 10)}`);
        }
      }
    }
    if (csv) {
      fs.writeFileSync(arg('csv'), '﻿' + csv.join('\n'));
      console.log(`\nDetalle por empleado y clave: ${arg('csv')} (${csv.length - 1} renglones)`);
    }
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
