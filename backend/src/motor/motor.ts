import { aCentavos, aPesos, porTasa } from './centavos';
import { isrDeTarifa, subsidioDeTabla } from './isr';
import type {
  ConceptoCalculado,
  ConceptoMotor,
  EmpleadoMotor,
  LineaRecibo,
  ResultadoRecibo,
  TablasMotor,
} from './tipos';

export type ModoCalculo = 'quincenal' | 'aguinaldo' | 'prima_vacacional';

interface Linea {
  concepto: ConceptoMotor;
  centavos: number;
  gravadoCentavos: number;
}

/**
 * Calcula el recibo de un empleado. Es una función pura: no lee la base ni el reloj, así que el
 * worker, el simulador de sueldo y las pruebas obtienen exactamente el mismo resultado.
 *
 * Orden quincenal (el mismo de 1CAL-N-P.W):
 *   1. Sueldo y compensación del tabulador, proporcionales a los días pagados.
 *   2. Percepciones y deducciones fijas del empleado, más lo capturado en la quincena.
 *   3. Base gravable e ISR con la tarifa; se resta el subsidio para el empleo.
 *   4. Cuotas ISSEMYM sobre la base de cotización.
 *   5. Descuentos a plazo y pensiones alimenticias, al final porque pueden ir sobre el neto.
 */
export function calcularRecibo(
  empleado: EmpleadoMotor,
  tablas: TablasMotor,
  modo: ModoCalculo = 'quincenal',
): ResultadoRecibo {
  const p = tablas.parametros;
  const lineas: Linea[] = [];
  const observaciones: string[] = [];

  const agregar = (concepto: ConceptoMotor | undefined, centavos: number, gravado?: number) => {
    if (!concepto || centavos === 0) return;
    const existente = lineas.find((l) => l.concepto.id === concepto.id);
    const gravadoCentavos =
      gravado ?? (concepto.naturaleza === 'P' && concepto.gravaIsr ? centavos : 0);
    if (existente) {
      existente.centavos += centavos;
      existente.gravadoCentavos += gravadoCentavos;
    } else {
      lineas.push({ concepto, centavos, gravadoCentavos });
    }
  };
  const calculado = (clave: ConceptoCalculado) => tablas.calculados[clave];
  const porId = (id: number) => {
    const concepto = tablas.conceptos.get(id);
    if (!concepto) observaciones.push(`Concepto ${id} no existe en el catálogo; se omitió.`);
    return concepto;
  };

  const dias = Math.max(0, Math.min(empleado.dias, p.diasQuincena));
  const sueldoDiario = aCentavos(empleado.sueldoMensual) / 30;

  if (modo === 'quincenal') {
    if (dias === 0) observaciones.push('Sin días por pagar en la quincena.');
    const proporcion = dias / p.diasQuincena;
    // Sueldo mensual entre dos quincenas, proporcional a los días: 15 días = media mensualidad.
    agregar(calculado('sueldo'), Math.round((aCentavos(empleado.sueldoMensual) / 2) * proporcion));
    agregar(
      calculado('compensacion'),
      Math.round((aCentavos(empleado.compensacionMensual) / 2) * proporcion),
    );
    for (const fijo of empleado.fijos) {
      const concepto = porId(fijo.conceptoId);
      if (!concepto) continue;
      // Las percepciones fijas se pagan por día trabajado; las deducciones fijas van completas.
      const factor = concepto.naturaleza === 'P' ? proporcion : 1;
      agregar(concepto, Math.round(aCentavos(fijo.importe) * factor));
    }
  } else {
    const anual = Math.max(0, Math.min(empleado.proporcionAnual ?? 1, 1));
    const exentoUma = modo === 'aguinaldo' ? 30 : 15;
    const exento = aCentavos(p.umaDiaria * exentoUma);
    const importe =
      modo === 'aguinaldo'
        ? Math.round(sueldoDiario * p.diasAguinaldo * anual)
        : Math.round(sueldoDiario * p.diasPrimaVacacional * (p.porcentajePrimaVacacional / 100));
    agregar(calculado(modo), importe, Math.max(0, importe - exento));
  }

  for (const captura of empleado.capturas) {
    agregar(porId(captura.conceptoId), aCentavos(captura.importe));
  }

  // --- ISR -------------------------------------------------------------------------------------
  const baseIsr = lineas
    .filter((l) => l.concepto.naturaleza === 'P')
    .reduce((suma, l) => suma + l.gravadoCentavos, 0);
  const isrCausado = isrDeTarifa(baseIsr, tablas.isr);
  const subsidio = modo === 'quincenal' ? subsidioDeTabla(baseIsr, tablas.subsidio) : 0;
  // Desde 2024 el subsidio solo reduce el impuesto: si es mayor, la diferencia no se entrega.
  agregar(calculado('isr'), Math.max(0, isrCausado - subsidio));

  // --- ISSEMYM ---------------------------------------------------------------------------------
  let baseIssemym = 0;
  if (modo === 'quincenal') {
    baseIssemym = lineas
      .filter((l) => l.concepto.naturaleza === 'P')
      .reduce((suma, l) => suma + Math.round(l.centavos * l.concepto.factorIssemym), 0);
    if (p.topeIssemym > 0) baseIssemym = Math.min(baseIssemym, aCentavos(p.topeIssemym));
    agregar(calculado('issemym_salud'), porTasa(baseIssemym, p.tasaIssemymSalud));
    agregar(calculado('issemym_pension'), porTasa(baseIssemym, p.tasaIssemymPension));
  }

  // --- Descuentos a plazo y pensiones ----------------------------------------------------------
  for (const descuento of empleado.descuentosPlazo) {
    const concepto = porId(descuento.conceptoId);
    if (!concepto) continue;
    let centavos = aCentavos(descuento.importeQuincenal);
    if (descuento.porcentaje) {
      const percepciones = sumar(lineas, 'P');
      const deducciones = sumar(lineas, 'D');
      centavos = porTasa(Math.max(0, percepciones - deducciones), descuento.porcentaje / 100);
    }
    agregar(concepto, centavos);
  }

  const totalPercepciones = sumar(lineas, 'P');
  const totalDeducciones = sumar(lineas, 'D');
  const neto = totalPercepciones - totalDeducciones;
  if (neto < 0) observaciones.push('Neto negativo: las deducciones superan a las percepciones.');

  return {
    lineas: lineas
      .filter((l) => l.centavos !== 0)
      .sort(
        (a, b) =>
          b.concepto.naturaleza.localeCompare(a.concepto.naturaleza) ||
          a.concepto.clave - b.concepto.clave,
      )
      .map(
        (l): LineaRecibo => ({
          conceptoId: l.concepto.id,
          clave: l.concepto.clave,
          descripcion: l.concepto.descripcion,
          naturaleza: l.concepto.naturaleza,
          importe: aPesos(l.centavos),
          gravadoIsr: aPesos(l.gravadoCentavos),
          partida: l.concepto.partida,
        }),
      ),
    dias: modo === 'quincenal' ? dias : 0,
    baseIsr: aPesos(baseIsr),
    baseIssemym: aPesos(baseIssemym),
    isrCausado: aPesos(isrCausado),
    subsidio: aPesos(subsidio),
    totalPercepciones: aPesos(totalPercepciones),
    totalDeducciones: aPesos(totalDeducciones),
    neto: aPesos(neto),
    observaciones,
  };
}

function sumar(lineas: Linea[], naturaleza: 'P' | 'D'): number {
  return lineas
    .filter((l) => l.concepto.naturaleza === naturaleza)
    .reduce((suma, l) => suma + l.centavos, 0);
}

/**
 * Días a pagar de una quincena según alta, baja y permisos sin goce. Quincena comercial: cada
 * quincena vale 15 días aunque el mes tenga 28 o 31, como en el sistema anterior.
 */
export function diasPagables(
  quincena: { inicio: string; fin: string },
  empleado: { fechaAlta: string; fechaBaja: string | null },
  permisos: { inicio: string; fin: string | null }[],
  diasQuincena = 15,
): number {
  const inicio = maxFecha(quincena.inicio, empleado.fechaAlta);
  const fin = empleado.fechaBaja ? minFecha(quincena.fin, empleado.fechaBaja) : quincena.fin;
  if (inicio > fin) return 0;

  const naturales = diferenciaDias(quincena.inicio, quincena.fin) + 1;
  let trabajados = diferenciaDias(inicio, fin) + 1;
  for (const permiso of permisos) {
    const desde = maxFecha(inicio, permiso.inicio);
    const hasta = minFecha(fin, permiso.fin ?? fin);
    if (desde <= hasta) trabajados -= diferenciaDias(desde, hasta) + 1;
  }
  trabajados = Math.max(0, trabajados);
  if (trabajados === naturales) return diasQuincena;
  // Proporción sobre los días naturales de la quincena, llevada a 15 días comerciales.
  return Math.round((trabajados / naturales) * diasQuincena * 100) / 100;
}

const maxFecha = (a: string, b: string) => (a > b ? a : b);
const minFecha = (a: string, b: string) => (a < b ? a : b);
const diferenciaDias = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
