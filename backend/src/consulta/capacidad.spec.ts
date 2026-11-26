import { capacidad } from './capacidad';

describe('capacidad de descuento', () => {
  it('suma solo las claves de ingreso que tiene, resta todas las deducciones y toma el 30 %', () => {
    const r = capacidad([
      { clave: 1, descripcion: 'SUELDO', naturaleza: 'P', importe: 5496.7 },
      { clave: 12, descripcion: 'GRATIFICACION', naturaleza: 'P', importe: 2528.5 },
      { clave: 17, descripcion: 'GRAT. EXTRA', naturaleza: 'P', importe: 1000 },
      { clave: 27, descripcion: 'TIEMPO EXTRA', naturaleza: 'P', importe: 900 },
      { clave: 501, descripcion: 'ISR', naturaleza: 'D', importe: 1200.35 },
      { clave: 559, descripcion: 'PRESTAMO', naturaleza: 'D', importe: 500 },
    ]);
    expect(r.percepciones.map((p) => p.clave)).toEqual([1, 12, 17]);
    expect(r).toMatchObject({ totalPercepciones: 9025.2, totalDeducciones: 1700.35, neto: 7324.85, maximoDescuento: 2197.45 });
  });
  it('si las deducciones pasan el ingreso, no se puede descontar nada', () => {
    const r = capacidad([
      { clave: 1, descripcion: 'SUELDO', naturaleza: 'P', importe: 100 },
      { clave: 559, descripcion: 'PRESTAMO', naturaleza: 'D', importe: 300 },
    ]);
    expect(r).toMatchObject({ neto: -200, maximoDescuento: 0 });
  });
});
