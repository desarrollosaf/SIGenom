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
