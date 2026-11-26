/** Claves que cuentan como ingreso para saber cuánto se le puede descontar a una persona. */
export const CLAVES_INGRESO = [1, 11, 12, 14, 17, 34];
/** Lo más que se le puede descontar del neto, en porcentaje. */
export const PORCENTAJE_MAXIMO = 30;

export interface LineaRecibo {
  clave: number;
  descripcion: string;
  naturaleza: 'P' | 'D';
  importe: number;
}

/**
 * Ingreso = las claves de CLAVES_INGRESO que tenga (la que no tiene no suma); menos todas sus deducciones
 * del recibo, tal cual. Lo más que se puede descontar es el PORCENTAJE_MAXIMO de ese neto, nunca negativo.
 * Todo en centavos para no arrastrar decimales.
 */
export function capacidad(lineas: LineaRecibo[]) {
  const centavos = (n: number) => Math.round(Number(n) * 100);
  const porClave = new Map<number, { clave: number; descripcion: string; centavos: number }>();
  let deducciones = 0;
  for (const l of lineas) {
    if (l.naturaleza === 'D') deducciones += centavos(l.importe);
    else if (CLAVES_INGRESO.includes(l.clave)) {
      const p = porClave.get(l.clave) ?? { clave: l.clave, descripcion: l.descripcion, centavos: 0 };
      p.centavos += centavos(l.importe);
      porClave.set(l.clave, p);
    }
  }
  const percepciones = [...porClave.values()].sort((a, b) => a.clave - b.clave);
  const ingreso = percepciones.reduce((s, p) => s + p.centavos, 0);
  const neto = ingreso - deducciones;
  // Hacia abajo: nunca se ofrece un centavo de más.
  const maximo = Math.max(0, Math.floor((neto * PORCENTAJE_MAXIMO) / 100));
  return {
    percepciones: percepciones.map((p) => ({ clave: p.clave, descripcion: p.descripcion, importe: p.centavos / 100 })),
    totalPercepciones: ingreso / 100,
    totalDeducciones: deducciones / 100,
    neto: neto / 100,
    porcentaje: PORCENTAJE_MAXIMO,
    maximoDescuento: maximo / 100,
  };
}
