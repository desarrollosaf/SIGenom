import { leerTablaRang } from '../catalogos/tabla-rang.service';
import { buscarImporte } from '../quincena/ajuste-neto.service';
import { calcularRecibo, diasPagables } from './motor';
import { isrDeTarifa, subsidioDeTabla } from './isr';
import { fechasDeQuincena, quincenaDeFecha } from './periodos';
import type { ConceptoMotor, TablasMotor } from './tipos';

const concepto = (
  id: number,
  naturaleza: 'P' | 'D',
  extra: Partial<ConceptoMotor> = {},
): ConceptoMotor => ({
  id,
  clave: id,
  descripcion: `C${id}`,
  naturaleza,
  gravaIsr: naturaleza === 'P',
  factorIssemym: naturaleza === 'P' ? 1 : 0,
  partida: null,
  calculado: null,
  timbra: true,
  ...extra,
});

const sueldo = concepto(1, 'P', { calculado: 'sueldo' });
const despensa = concepto(5, 'P', { gravaIsr: false, factorIssemym: 0 });
const isr = concepto(51, 'D', { calculado: 'isr' });
const salud = concepto(52, 'D', { calculado: 'issemym_salud' });
const prestamo = concepto(70, 'D');
const pension = concepto(80, 'D');
const aguinaldo = concepto(15, 'P', { calculado: 'aguinaldo' });

const tablas: TablasMotor = {
  // Tarifa quincenal 2025 (primeros renglones), suficiente para las pruebas.
  isr: [
    { limiteInferior: 0.01, cuotaFija: 0, porcentaje: 1.92 },
    { limiteInferior: 368.11, cuotaFija: 7.05, porcentaje: 6.4 },
    { limiteInferior: 3124.36, cuotaFija: 183.45, porcentaje: 10.88 },
    { limiteInferior: 5490.76, cuotaFija: 441.0, porcentaje: 16 },
  ],
  subsidio: [
    { ingresoDesde: 0, subsidio: 237.0 },
    { ingresoDesde: 5065.5, subsidio: 0 },
  ],
  parametros: {
    diasQuincena: 15,
    tasaIssemymSalud: 0.04625,
    tasaIssemymPension: 0,
    topeIssemym: 0,
    diasAguinaldo: 40,
    diasPrimaVacacional: 10,
    porcentajePrimaVacacional: 25,
    umaDiaria: 113.14,
  },
  conceptos: new Map([sueldo, despensa, isr, salud, prestamo, pension, aguinaldo].map((c) => [c.id, c])),
  calculados: { sueldo, isr, issemym_salud: salud, aguinaldo },
};

describe('isrDeTarifa', () => {
  it('aplica cuota fija más el porcentaje sobre el excedente', () => {
    // 4000.00: (4000 - 3124.36) * 10.88 % + 183.45 = 278.72
    expect(isrDeTarifa(400000, tablas.isr)).toBe(27872);
  });

  it('no causa impuesto sin base', () => {
    expect(isrDeTarifa(0, tablas.isr)).toBe(0);
  });

  it('toma el subsidio del renglón que corresponde', () => {
    expect(subsidioDeTabla(400000, tablas.subsidio)).toBe(23700);
    expect(subsidioDeTabla(600000, tablas.subsidio)).toBe(0);
  });
});

describe('calcularRecibo', () => {
  const base = {
    empleadoId: 1,
    sueldoMensual: 12000,
    compensacionMensual: 0,
    dias: 15,
    fijos: [{ conceptoId: 5, importe: 500 }],
    capturas: [],
    descuentosPlazo: [],
  };

  it('arma una quincena completa', () => {
    const r = calcularRecibo(base, tablas);
    // Sueldo 6000 gravable; despensa 500 exenta.
    expect(r.baseIsr).toBe(6000);
    // (6000 - 5490.76) * 16 % + 441 = 522.48; sin subsidio por rebasar el tope.
    expect(r.isrCausado).toBe(522.48);
    expect(r.subsidio).toBe(0);
    // ISSEMYM 4.625 % de 6000 = 277.50
    expect(r.lineas.find((l) => l.conceptoId === 52)?.importe).toBe(277.5);
    expect(r.totalPercepciones).toBe(6500);
    expect(r.totalDeducciones).toBe(799.98);
    expect(r.neto).toBe(5700.02);
  });

  it('paga proporcional a los días y no prorratea deducciones fijas', () => {
    const r = calcularRecibo(
      { ...base, dias: 7.5, fijos: [...base.fijos, { conceptoId: 70, importe: 300 }] },
      tablas,
    );
    expect(r.lineas.find((l) => l.conceptoId === 1)?.importe).toBe(3000);
    expect(r.lineas.find((l) => l.conceptoId === 5)?.importe).toBe(250);
    expect(r.lineas.find((l) => l.conceptoId === 70)?.importe).toBe(300);
  });

  it('el subsidio reduce el ISR sin volverlo negativo', () => {
    const r = calcularRecibo({ ...base, sueldoMensual: 4000, fijos: [] }, tablas);
    // Base 2000: (2000 - 368.11) * 6.4 % + 7.05 = 111.49, subsidio 237: no se retiene ISR.
    expect(r.isrCausado).toBe(111.49);
    expect(r.lineas.find((l) => l.conceptoId === 51)).toBeUndefined();
  });

  it('descuenta pensión alimenticia como porcentaje del neto', () => {
    const r = calcularRecibo(
      { ...base, fijos: [], descuentosPlazo: [{ conceptoId: 80, importeQuincenal: 0, porcentaje: 30 }] },
      tablas,
    );
    // Neto antes de pensión: 6000 - 522.48 - 277.50 = 5200.02; 30 % = 1560.01
    expect(r.lineas.find((l) => l.conceptoId === 80)?.importe).toBe(1560.01);
  });

  it('avisa del neto negativo', () => {
    const r = calcularRecibo(
      { ...base, capturas: [{ conceptoId: 70, importe: 9000 }] },
      tablas,
    );
    expect(r.neto).toBeLessThan(0);
    expect(r.observaciones.join(' ')).toContain('Neto negativo');
  });

  it('calcula aguinaldo proporcional con la parte exenta de 30 UMA', () => {
    const r = calcularRecibo({ ...base, proporcionAnual: 0.5 }, tablas, 'aguinaldo');
    // 400 diarios * 40 días * 0.5 = 8000; exento 30 * 113.14 = 3394.20; gravado 4605.80
    expect(r.totalPercepciones).toBe(8000);
    expect(r.baseIsr).toBe(4605.8);
  });
});

describe('diasPagables', () => {
  const q = fechasDeQuincena(2026, 21); // 1 al 15 de noviembre
  it('quincena completa', () => {
    expect(diasPagables(q, { fechaAlta: '2020-01-01', fechaBaja: null }, [])).toBe(15);
  });
  it('alta a media quincena', () => {
    expect(diasPagables(q, { fechaAlta: '2026-11-09', fechaBaja: null }, [])).toBe(7);
  });
  it('permiso sin goce dentro de la quincena', () => {
    const permisos = [{ inicio: '2026-11-11', fin: '2026-11-20' }];
    expect(diasPagables(q, { fechaAlta: '2020-01-01', fechaBaja: null }, permisos)).toBe(10);
  });
  it('baja antes de la quincena', () => {
    expect(diasPagables(q, { fechaAlta: '2020-01-01', fechaBaja: '2026-10-31' }, [])).toBe(0);
  });
});

describe('periodos', () => {
  it('ubica las quincenas del año', () => {
    expect(fechasDeQuincena(2026, 4)).toEqual({ inicio: '2026-02-16', fin: '2026-02-28' });
    expect(quincenaDeFecha('2026-11-12')).toEqual({ anio: 2026, quincena: 21 });
  });
});

describe('como el sistema anterior en 2025', () => {
  const c = (id: number, clave: number, naturaleza: 'P' | 'D', extra: Partial<ConceptoMotor> = {}) => concepto(id, naturaleza, { clave, ...extra });
  const lista = [
    c(1, 17, 'P'), c(2, 27, 'P', { factorIssemym: 0 }), c(3, 101, 'P'), c(4, 34, 'P', { gravaIsr: false }), c(9, 601, 'D'),
    c(11, 501, 'D', { calculado: 'isr' }), c(12, 511, 'D', { calculado: 'issemym_pension' }), c(13, 512, 'D', { calculado: 'issemym_salud' }),
    c(14, 611, 'D', { calculado: 'issemym_pens_retro' }), c(15, 612, 'D', { calculado: 'issemym_salud_retro' }),
    c(16, 549, 'D', { calculado: 'sci' }), c(17, 649, 'D', { calculado: 'sci_retro' }),
  ];
  const tablas2025: TablasMotor = {
    isr: [
      { limiteInferior: 0.01, cuotaFija: 0, porcentaje: 1.92 },
      { limiteInferior: 746.05, cuotaFija: 14.32, porcentaje: 6.4 },
      { limiteInferior: 6332.06, cuotaFija: 371.83, porcentaje: 10.88 },
      { limiteInferior: 11128.02, cuotaFija: 893.63, porcentaje: 16 },
      { limiteInferior: 12935.83, cuotaFija: 1182.88, porcentaje: 17.92 },
      { limiteInferior: 15487.72, cuotaFija: 1640.18, porcentaje: 21.36 },
      { limiteInferior: 31236.5, cuotaFija: 5004.12, porcentaje: 23.52 },
    ],
    subsidio: [{ ingresoDesde: 0, subsidio: 390 }, { ingresoDesde: 9081.01, subsidio: 0 }],
    parametros: {
      ...tablas.parametros, tasaIssemymPension: 0.061, topeIssemym: 67841.33,
      isrMensual: 1, isrAjusteMensual: 1, redondeoIsr: 5, isrMinimo: 0.05, tasaSci: 0.014,
    },
    conceptos: new Map(lista.map((x) => [x.id, x])),
    calculados: Object.fromEntries(lista.filter((x) => x.calculado).map((x) => [x.calculado, x])),
  };
  const emp = { empleadoId: 1, sueldoMensual: 0, compensacionMensual: 0, dias: 15, fijos: [], descuentosPlazo: [] };
  const de = (r: ReturnType<typeof calcularRecibo>, clave: number) => r.lineas.find((l) => l.clave === clave)?.importe;

  it('1a quincena: tarifa mensual sobre el doble, entre dos, a múltiplos de 5 centavos', () => {
    const r = calcularRecibo({ ...emp, capturas: [{ conceptoId: 1, importe: 14556.9 }] }, tablas2025);
    expect(de(r, 501)).toBe(2275.35);
  });

  it('2a quincena: ISR del mes menos lo retenido en la 1a', () => {
    const capturas = [{ conceptoId: 1, importe: 14556.9 }, { conceptoId: 2, importe: 1795.15 }];
    const r = calcularRecibo({ ...emp, capturas, primeraQuincena: { baseIsr: 14556.9, isr: 2275.35 } }, tablas2025);
    expect(de(r, 501)).toBe(2658.8);
    expect(r.baseTarifa).toBe(30908.95);
  });

  it('subsidio de 390 mensuales y mínimo de 5 centavos', () => {
    expect(de(calcularRecibo({ ...emp, capturas: [{ conceptoId: 1, importe: 4313.9 }] }, tablas2025), 501)).toBe(115.8);
    expect(de(calcularRecibo({ ...emp, capturas: [{ conceptoId: 1, importe: 1500 }] }, tablas2025), 501)).toBe(0.05);
  });

  it('cuotas ISSEMYM y SCI, con las del retroactivo aparte', () => {
    const r = calcularRecibo({ ...emp, sci: true, capturas: [{ conceptoId: 1, importe: 25909.3 }, { conceptoId: 3, importe: 1000 }] }, tablas2025);
    expect([511, 512, 549, 611, 612, 649].map((k) => de(r, k))).toEqual([1580.47, 1198.31, 362.73, 61, 46.25, 14]);
    expect(r.baseIsr).toBe(26909.3);
  });

  it('topa las cuotas y no descuenta SCI a quien no aporta', () => {
    const r = calcularRecibo({ ...emp, capturas: [{ conceptoId: 1, importe: 74842 }] }, tablas2025);
    expect([de(r, 511), de(r, 512), de(r, 549)]).toEqual([4138.32, 3137.66, undefined]);
  });

  it('si el ISR del retroactivo viene aparte (601), no entra a la base del 501', () => {
    const r = calcularRecibo({ ...emp, capturas: [{ conceptoId: 1, importe: 14556.9 }, { conceptoId: 3, importe: 1000 }, { conceptoId: 9, importe: 200 }] }, tablas2025);
    expect(de(r, 501)).toBe(2275.35);
  });

  it('el ajuste de neto encuentra el menor importe que llega al objetivo', () => {
    const con = (cent: number) =>
      calcularRecibo({ ...emp, sci: true, capturas: [{ conceptoId: 1, importe: 8000 + cent / 100 }, { conceptoId: 9, importe: 6600 }] }, tablas2025);
    const neto = (cent: number) => Math.round(con(cent).neto * 100);
    expect(neto(0)).toBeLessThan(0);
    const x = buscarImporte(neto, 1, 10_000_00)!;
    expect(neto(x)).toBeGreaterThanOrEqual(1);
    expect(neto(x)).toBeLessThanOrEqual(6);
    expect(neto(x - 1)).toBeLessThan(1);
    expect(buscarImporte((n) => n - 500, 1, 100)).toBeNull();
  });
});

describe('leerTablaRang', () => {
  it('lee el CSV de Excel y omite el nivel 0', () => {
    const enc = 'NIVEL ;IMP-NIVEL;IMP-RAN-1;IMP-RAN-2;IMP-RAN-3;IMP-RAN-4;IMP-RAN-5;IMP-COMP-1;IMP-COMP-2;IMP-COMP-3;IMP-COMP-4;IMP-COMP-5';
    const filas = leerTablaRang(`${enc}\r\n\r\n0;3500;1;2;3;4;5;0,5;1;1,5;2;2,5\r\n17;6214;0;1767,05;2937,3;3934,35;883,75;1311,6;1685,45;1933,1;2144,35;1498,45\r\n`);
    expect(filas).toHaveLength(5);
    expect(filas[3]).toEqual({ nivel: 17, rango: 4, sueldoQ: 6214, gratificacionQ: 3934.35, compensacionQ: 2144.35 });
  });
  it('lee el respaldo sin encabezado y rechaza otros archivos', () => {
    expect(leerTablaRang('17 6214 0 1767.05 2937.3 3934.35 883.75 1311.6 1685.45 1933.1 2144.35 1498.45\n')[0].compensacionQ).toBe(1311.6);
    expect(() => leerTablaRang('hola mundo')).toThrow();
  });
});
