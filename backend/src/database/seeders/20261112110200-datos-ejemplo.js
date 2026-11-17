'use strict';

require('dotenv').config();

/**
 * Datos ficticios para probar el sistema: adscripciones, puestos, tabulador, 160 empleados y la
 * quincena en curso con algunas capturas. Ningún nombre, CURP ni cuenta es real.
 * Solo corre con SEED_DATOS_EJEMPLO=true; nunca en producción.
 */

const ADSCRIPCIONES = [
  [100, 'Junta de Coordinación Política', '01'],
  [110, 'Presidencia de la Mesa Directiva', '01'],
  [200, 'Secretaría de Asuntos Parlamentarios', '02'],
  [210, 'Dirección de Procesos Legislativos', '02'],
  [300, 'Secretaría de Administración y Finanzas', '03'],
  [310, 'Dirección de Administración y Desarrollo de Personal', '03'],
  [320, 'Dirección de Finanzas', '03'],
  [330, 'Unidad de Tecnologías de la Información', '03'],
  [400, 'Contraloría', '04'],
  [500, 'Instituto de Estudios Legislativos', '05'],
  [600, 'Dirección General de Comunicación Social', '06'],
];

const PUESTOS = [
  ['AUX-ADM', 'Auxiliar administrativo'],
  ['ANALISTA', 'Analista'],
  ['ANA-ESP', 'Analista especializado'],
  ['SECRET', 'Secretaria'],
  ['CHOFER', 'Chofer'],
  ['JEFE-DEP', 'Jefe de departamento'],
  ['SUBDIR', 'Subdirector'],
  ['DIRECTOR', 'Director'],
  ['ASESOR', 'Asesor'],
  ['DIPUTADO', 'Diputado'],
];

const PATERNOS = ['García', 'Hernández', 'Martínez', 'López', 'González', 'Pérez', 'Rodríguez', 'Sánchez', 'Ramírez', 'Cruz', 'Flores', 'Gómez', 'Morales', 'Vázquez', 'Reyes', 'Jiménez', 'Torres', 'Díaz', 'Gutiérrez', 'Ruiz', 'Mendoza', 'Aguilar', 'Ortiz', 'Castillo', 'Romero', 'Álvarez', 'Chávez', 'Ramos', 'Domínguez', 'Velázquez'];
const NOMBRES_H = ['José', 'Juan', 'Luis', 'Carlos', 'Miguel', 'Jorge', 'Alejandro', 'Ricardo', 'Fernando', 'Eduardo', 'Arturo', 'Roberto', 'Sergio', 'Raúl', 'Héctor'];
const NOMBRES_M = ['María', 'Guadalupe', 'Ana', 'Laura', 'Patricia', 'Verónica', 'Gabriela', 'Claudia', 'Adriana', 'Alejandra', 'Leticia', 'Rosa', 'Silvia', 'Mónica', 'Elena'];

/** Generador determinista: siempre los mismos datos. */
function azar(semilla) {
  let s = semilla;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const CONSONANTES = 'BCDFGHJKLMNPQRSTVWXYZ';

function curpDe(paterno, materno, nombre, fecha, sexo, r) {
  const p = sinAcentos(paterno);
  const m = sinAcentos(materno);
  const n = sinAcentos(nombre);
  const vocal = (p.slice(1).match(/[AEIOU]/) || ['X'])[0];
  const consonante = (t) => (t.slice(1).match(/[B-DF-HJ-NP-TV-Z]/) || ['X'])[0];
  const yymmdd = fecha.slice(2, 4) + fecha.slice(5, 7) + fecha.slice(8, 10);
  return p[0] + vocal + m[0] + n[0] + yymmdd + sexo + 'MC' + consonante(p) + consonante(m) + consonante(n) + 'A' + Math.floor(r() * 10);
}

const ALFANUM = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

/** @type {import('sequelize-cli').Seeder} */
module.exports = {
  async up(queryInterface) {
    if (process.env.SEED_DATOS_EJEMPLO !== 'true') return;
    const [[{ total }]] = await queryInterface.sequelize.query('SELECT count(*)::int total FROM empleados');
    if (total > 0) return;

    const ahora = new Date();
    const t = { created_at: ahora, updated_at: ahora };
    const r = azar(20261112);

    await queryInterface.bulkInsert('adscripciones', ADSCRIPCIONES.map(([id, descripcion, area_presupuestal]) => ({ id, descripcion, area_presupuestal, activo: true, ...t })));
    await queryInterface.bulkInsert('puestos', PUESTOS.map(([clave, descripcion]) => ({ clave, descripcion, activo: true, ...t })));

    // Tabulador de 25 niveles y 5 rangos: cada nivel 9 % más que el anterior, cada rango 4 % más.
    const tabulador = [];
    for (let nivel = 1; nivel <= 25; nivel++) {
      for (let rango = 1; rango <= 5; rango++) {
        const sueldo = Math.round(7400 * Math.pow(1.09, nivel - 1) * (1 + 0.04 * (rango - 1)));
        tabulador.push({ nivel, rango, sueldo_mensual: sueldo, compensacion_mensual: nivel >= 14 ? Math.round(sueldo * 0.35) : 0, ...t });
      }
    }
    await queryInterface.bulkInsert('tabulador', tabulador);

    const [conceptos] = await queryInterface.sequelize.query('SELECT id, tipo_nomina, clave FROM conceptos');
    const concepto = (tipo, clave) => conceptos.find((c) => c.tipo_nomina === tipo && c.clave === clave).id;

    // --- Empleados ---
    const empleados = [];
    const puestoPorNivel = (nivel) => (nivel <= 3 ? 'AUX-ADM' : nivel <= 6 ? 'SECRET' : nivel <= 10 ? 'ANALISTA' : nivel <= 13 ? 'ANA-ESP' : nivel <= 16 ? 'JEFE-DEP' : nivel <= 19 ? 'SUBDIR' : nivel <= 22 ? 'ASESOR' : 'DIRECTOR');
    for (let i = 0; i < 160; i++) {
      const tipo = i < 130 ? 'P' : i < 145 ? 'H' : 'D';
      const sexo = r() < 0.5 ? 'H' : 'M';
      const paterno = PATERNOS[Math.floor(r() * PATERNOS.length)];
      const materno = PATERNOS[Math.floor(r() * PATERNOS.length)];
      const nombre = (sexo === 'H' ? NOMBRES_H : NOMBRES_M)[Math.floor(r() * 15)];
      const anioNac = 1965 + Math.floor(r() * 35);
      const nacimiento = `${anioNac}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
      const curp = curpDe(paterno, materno, nombre, nacimiento, sexo, r);
      const rfc = curp.slice(0, 10) + Array.from({ length: 3 }, () => ALFANUM[Math.floor(r() * ALFANUM.length)]).join('');
      const nivel = tipo === 'D' ? 25 : 1 + Math.floor(Math.pow(r(), 1.6) * 24);
      const alta = `${2005 + Math.floor(r() * 21)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-01`;
      let cuenta = '0' + Array.from({ length: 15 }, () => Math.floor(r() * 10)).join('');
      if (cuenta.slice(12) === '0000') cuenta = cuenta.slice(0, 12) + '1234';
      empleados.push({
        curp,
        rfc,
        apellido_paterno: paterno,
        apellido_materno: materno,
        nombres: nombre,
        tipo_nomina: tipo,
        adscripcion_id: tipo === 'D' ? 100 : ADSCRIPCIONES[Math.floor(r() * ADSCRIPCIONES.length)][0],
        puesto_clave: tipo === 'D' ? 'DIPUTADO' : puestoPorNivel(nivel),
        nivel,
        rango: 1 + Math.floor(r() * 5),
        numero_issemym: tipo === 'H' ? null : 100000 + i * 37,
        sindicalizado: tipo === 'P' && nivel <= 10 && r() < 0.7,
        sci: r() < 0.3,
        estado: 'activo',
        fecha_alta: alta,
        fecha_ingreso_gobierno: alta,
        fecha_nacimiento: nacimiento,
        codigo_postal_fiscal: '50000',
        banco: 'CITIBANAMEX',
        // Casos para los diagnósticos: dos sin cuenta, dos con cheque y una cuenta repetida.
        cuenta_bancaria: i === 7 || i === 41 ? null : i === 63 ? empleados[62]?.cuenta_bancaria ?? cuenta : cuenta,
        pago_cheque: i === 12 || i === 88,
        ...t,
      });
    }
    // Un nivel fuera del tabulador, para que aparezca en Verificación.
    empleados[100].nivel = 26;
    await queryInterface.bulkInsert('empleados', empleados);
    const [filas] = await queryInterface.sequelize.query('SELECT id, tipo_nomina, nivel, sindicalizado FROM empleados ORDER BY id');

    await queryInterface.bulkInsert('datos_personales', filas.map((e) => ({ empleado_id: e.id, entidad: 'México', ...t })));

    // --- Percepciones y deducciones fijas ---
    const fijos = [];
    const plazos = [];
    const cuentas = [];
    filas.forEach((e, i) => {
      const tipo = e.tipo_nomina;
      // Claves del sistema anterior: 014 prima de permanencia, 017 gratificación extra, 502 pensión
      // alimenticia, 522 INFONACOT, 531 estancia ISSEMYM, 550 ahorro SCI.
      if (tipo !== 'H') fijos.push({ empleado_id: e.id, concepto_id: concepto(tipo, 17), importe: 750 });
      if (tipo === 'P' && i % 3 === 0) fijos.push({ empleado_id: e.id, concepto_id: concepto(tipo, 14), importe: 120 + (i % 7) * 40 });
      if (tipo === 'P' && i % 5 === 0) fijos.push({ empleado_id: e.id, concepto_id: concepto(tipo, 531), importe: 450 + (i % 4) * 150 });
      if (tipo === 'P' && i % 4 === 0) plazos.push({ empleado_id: e.id, concepto_id: concepto(tipo, 522), importe_quincenal: 300, quincenas_pendientes: 12 + (i % 10), activo: true });
      if (i === 15 || i === 47) plazos.push({ empleado_id: e.id, concepto_id: concepto(tipo, 502), importe_quincenal: 0, porcentaje: 25, beneficiario: 'Beneficiaria de ejemplo', activo: true });
      if (tipo === 'P' && i % 11 === 0) {
        fijos.push({ empleado_id: e.id, concepto_id: concepto(tipo, 550), importe: 500 });
        // Uno sin su cuenta contable, para el diagnóstico de préstamos y aportaciones.
        if (i !== 22) cuentas.push({ empleado_id: e.id, concepto_id: concepto(tipo, 550), partida: '211900000' + (i % 9) });
      }
    });
    await queryInterface.bulkInsert('empleado_conceptos', fijos.map((f) => ({ ...f, ...t })));
    await queryInterface.bulkInsert('descuentos_plazo', plazos.map((p) => ({ porcentaje: null, beneficiario: null, ...p, ...t })));
    await queryInterface.bulkInsert('cuentas_contables', cuentas.map((c) => ({ ...c, ...t })));

    // --- Movimientos: el alta de todos, una baja y un permiso ---
    const movimientos = filas.map((e, i) => ({ empleado_id: e.id, tipo: 'alta', fecha_inicio: empleados[i].fecha_alta, registrado_por: 'SEED', cancelado: false, ...t }));
    await queryInterface.bulkInsert('movimientos_personal', movimientos);

    // --- Quincena en curso de cada nómina, con capturas en la Principal ---
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const quincena = hoy.getMonth() * 2 + (hoy.getDate() <= 15 ? 1 : 2);
    const mes = Math.ceil(quincena / 2);
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const dd = (d) => `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const inicio = dd(quincena % 2 ? 1 : 16);
    const fin = dd(quincena % 2 ? 15 : ultimo);
    await queryInterface.bulkInsert(
      'periodos',
      ['P', 'H', 'D'].map((tipo) => ({ tipo_nomina: tipo, anio, quincena, fecha_inicio: inicio, fecha_fin: fin, fecha_pago: fin, estado: 'captura', ...t })),
    );
    const [[periodo]] = await queryInterface.sequelize.query(`SELECT id FROM periodos WHERE tipo_nomina = 'P' AND anio = ${anio} AND quincena = ${quincena}`);

    const principal = filas.filter((e) => e.tipo_nomina === 'P');
    const capturas = [];
    principal.slice(0, 40).forEach((e, i) => {
      if (i % 9 === 0) capturas.push({ empleado_id: e.id, concepto_id: concepto('P', 555), importe: 210, origen: 'comedor', referencia: null });
    });
    // Una captura a un empleado de baja: otro caso para Verificación.
    const baja = principal[120];
    await queryInterface.sequelize.query(`UPDATE empleados SET estado = 'baja', fecha_baja = '${anio - 1}-12-31' WHERE id = ${baja.id}`);
    await queryInterface.bulkInsert('movimientos_personal', [{ empleado_id: baja.id, tipo: 'baja', motivo_clave: 'B01', fecha_inicio: `${anio - 1}-12-31`, registrado_por: 'SEED', cancelado: false, ...t }]);
    capturas.push({ empleado_id: baja.id, concepto_id: concepto('P', 17), importe: 1500, origen: 'captura', referencia: null });
    await queryInterface.bulkInsert('capturas', capturas.map((c) => ({ periodo_id: periodo.id, registrado_por: 'SEED', ...c, ...t })));
  },

  async down(queryInterface) {
    for (const tabla of ['capturas', 'recibo_conceptos', 'recibos', 'calculos', 'periodos', 'movimientos_personal', 'cuentas_contables', 'descuentos_plazo', 'empleado_conceptos', 'datos_personales', 'sucursales_bancarias', 'empleados', 'tabulador', 'puestos', 'adscripciones']) {
      await queryInterface.bulkDelete(tabla, null);
    }
  },
};
