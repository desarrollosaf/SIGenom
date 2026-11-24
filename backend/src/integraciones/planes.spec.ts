import { LECTORES } from './lectores';
import { Contexto, planear } from './planes';

const concepto = (id: number, clave: number, naturaleza: 'P' | 'D', calculado: string | null = null) => ({ id, clave, descripcion: `C${clave}`, naturaleza, calculado, activo: true });
const ctx = (extra: Partial<Contexto> = {}): Contexto => ({
  empleado: { id: 7, tipoNomina: 'P', estado: 'activo', puestoClave: 'A011117', nivel: 17, rango: 4, adscripcionId: 11040, fijos: new Map([[17, 500]]) },
  ambiguo: false,
  periodo: { anio: 2025, quincena: 7, fechaInicio: '2025-04-01', fechaFin: '2025-04-15' },
  conceptos: new Map([concepto(1, 1, 'P', 'sueldo'), concepto(17, 17, 'P'), concepto(51, 551, 'D'), concepto(67, 67, 'P'), concepto(59, 559, 'D'), concepto(50, 501, 'D', 'isr')].map((c) => [c.clave, c])),
  puestos: new Set(['A011117', 'A011120']),
  adscripciones: new Set([11040, 12001]),
  tabulador: new Set(['17-4', '20-3']),
  plazo: null,
  conTxt: false,
  ...extra,
});
const mov = (sistema: 'personal' | 'checador' | 'prestamos', tipo: string, datos: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ sistema, tipo, subtipo: null, externoId: '9', curp: 'XXXX', rfc: null, nombre: 'PRUEBA', tipoNomina: 'P', anio: 2025, quincena: 7, fecha: '2025-04-03', datos, ...extra }) as Parameters<typeof planear>[0];

describe('movimientos de personal', () => {
  it('promoción: nivel del puesto y percepciones de mes a quincena, sin tocar las del tabulador', () => {
    const p = planear(mov('personal', 'P', { puestoClave: 'A011120', rango: 3, percepciones: [{ cve: 1, importe: '9999' }, { cve: 17, importe: '2000.50' }] }), ctx());
    expect(p.problema).toBeNull();
    expect(p.acciones).toEqual([
      { hacer: 'cambio', campos: { puestoClave: 'A011120', nivel: 20, rango: 3 } },
      { hacer: 'fija', conceptoId: 17, importe: 1000.25 },
    ]);
  });
  it('baja con el motivo del subtipo, y rechaza el que no conoce', () => {
    expect(planear(mov('personal', 'B', {}, { subtipo: 'JUB' }), ctx()).acciones).toEqual([{ hacer: 'baja', fecha: '2025-04-03', motivo: 'B04' }]);
    expect(planear(mov('personal', 'B', {}, { subtipo: 'XYZ' }), ctx()).problema).toContain('motivo');
  });
  it('licencia con sueldo no cambia nada; sin sueldo es permiso', () => {
    expect(planear(mov('personal', 'L', {}, { subtipo: 'CON' }), ctx())).toMatchObject({ problema: null, acciones: [] });
    expect(planear(mov('personal', 'L', { fTerm: '2025-04-30' }, { subtipo: 'SIN' }), ctx()).acciones).toEqual([{ hacer: 'permiso', inicio: '2025-04-03', fin: '2025-04-30', motivo: 'P01' }]);
  });
  it('alta nueva, y lo que la impide', () => {
    const datos = { puestoClave: 'A011120', rango: 3, adsAct: 12001, primerApellido: 'UNO', segundoApellido: 'DOS', nombres: 'TRES' };
    const alta = mov('personal', 'A', datos, { subtipo: 'NUE', rfc: 'XAXX010101000' });
    const p = planear(alta, ctx({ empleado: null }));
    expect(p.problema).toBeNull();
    expect(p.acciones[0]).toMatchObject({ hacer: 'alta', datos: { nivel: 20, rango: 3, adscripcionId: 12001, fechaAlta: '2025-04-03' } });
    expect(planear(alta, ctx()).problema).toContain('Ya está activa');
    expect(planear(mov('personal', 'A', { ...datos, adsAct: 5 }, { subtipo: 'NUE', rfc: 'XAXX010101000' }), ctx({ empleado: null })).problema).toContain('adscripción');
    expect(planear(mov('personal', 'A', { ...datos, puestoClave: 'Z999999' }, { subtipo: 'NUE', rfc: 'XAXX010101000' }), ctx({ empleado: null })).problema).toContain('puesto');
  });
  it('espera a su quincena y no toca a quien no encuentra o es dudoso', () => {
    expect(planear(mov('personal', 'B', {}, { subtipo: 'REN', quincena: 8 }), ctx()).problema).toContain('espera');
    expect(planear(mov('personal', 'B', {}, { subtipo: 'REN' }), ctx({ empleado: null })).problema).toContain('No se encontró');
    expect(planear(mov('personal', 'B', {}, { subtipo: 'REN' }), ctx({ ambiguo: true })).problema).toContain('más de una');
  });
});

describe('checadores', () => {
  it('falta y reintegro con su clave por omisión', () => {
    expect(planear(mov('checador', 'falta', { importe: '350.5', dias: '1' }), ctx()).acciones).toMatchObject([{ hacer: 'captura', conceptoId: 51, importe: 350.5 }]);
    expect(planear(mov('checador', 'reintegro', { importe: 350.5 }), ctx()).acciones).toMatchObject([{ conceptoId: 67 }]);
  });
  it('advierte si la quincena ya trae lo del sistema anterior', () => {
    expect(planear(mov('checador', 'falta', { importe: 10 }), ctx({ conTxt: true })).avisos[0]).toContain('dos veces');
    expect(planear(mov('personal', 'B', {}, { subtipo: 'REN' }), ctx({ conTxt: true })).avisos).toEqual([]);
  });
  it('rechaza importe malo, clave calculada o del lado contrario', () => {
    expect(planear(mov('checador', 'falta', { importe: -5 }), ctx()).problema).toContain('importe');
    expect(planear(mov('checador', 'otro', { importe: 5, clave: 501 }), ctx()).problema).toContain('calcula');
    expect(planear(mov('checador', 'falta', { importe: 5, clave: 17 }), ctx()).problema).toContain('no corresponde');
  });
});

describe('préstamos', () => {
  const plazo = { id: 3, conceptoId: 59, importeQuincenal: 400, quincenasPendientes: 10, activo: true };
  it('alta, y no la duplica', () => {
    const alta = mov('prestamos', 'alta', { prestamo: 'A1', clave: 559, importeQuincenal: 400, quincenas: 24 });
    expect(planear(alta, ctx()).acciones).toMatchObject([{ hacer: 'prestamo-nuevo', conceptoId: 59, importe: 400, quincenas: 24, referencia: 'A1' }]);
    expect(planear(alta, ctx({ plazo })).problema).toContain('ya está');
  });
  it('liquidación: termina y captura el saldo', () => {
    expect(planear(mov('prestamos', 'liquidacion', { prestamo: 'A1', importe: 1200 }), ctx({ plazo })).acciones).toMatchObject([
      { hacer: 'prestamo-cambio', campos: { activo: false, quincenasPendientes: 0 } },
      { hacer: 'captura', conceptoId: 59, importe: 1200 },
    ]);
    expect(planear(mov('prestamos', 'liquidacion', { prestamo: 'A1' }), ctx()).problema).toContain('No se encontró el préstamo');
  });
  it('cambio y suspensión', () => {
    expect(planear(mov('prestamos', 'cambio', { prestamo: 'A1', importeQuincenal: 450 }), ctx({ plazo })).acciones).toEqual([{ hacer: 'prestamo-cambio', plazoId: 3, campos: { importeQuincenal: 450 } }]);
    expect(planear(mov('prestamos', 'suspension', { prestamo: 'A1' }), ctx({ plazo })).acciones).toMatchObject([{ campos: { activo: false } }]);
  });
});

describe('lectores', () => {
  it('junta RFC y homoclave y toma la fecha que corresponde', () => {
    const l = LECTORES[0].leer({ id: 5, tipo_mov: 'A', subtipo: 'nue', rfc: 'XAXX010101', datos: '{"homoclave":"AB1","fAlta":"2025-04-01","tipoNomina":"p"}', anio: 2025, no_qna: 7, nombre: 'X', fecha_mov: '2025-03-28' });
    expect(l).toMatchObject({ externoId: '5', rfc: 'XAXX010101AB1', fecha: '2025-04-01', tipoNomina: 'P', subtipo: 'NUE' });
  });
  it('solo lee', () => {
    for (const l of LECTORES) expect(l.sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
  });
});
