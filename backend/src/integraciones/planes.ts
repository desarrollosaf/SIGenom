import type { AjustesExterno, MovimientoExterno } from '../database/models/externos.models';

/** Lo que un movimiento va a cambiar, en palabras, y lo que impide aplicarlo. */
export interface Plan {
  empleadoId: number | null;
  efecto: string[];
  avisos: string[];
  problema: string | null;
  acciones: Accion[];
}

export type Accion =
  | { hacer: 'alta'; datos: AltaExterna }
  | { hacer: 'reingreso'; fecha: string }
  | { hacer: 'baja'; fecha: string; motivo: string }
  | { hacer: 'permiso'; inicio: string; fin: string | null; motivo: string }
  | { hacer: 'cambio'; campos: { puestoClave?: string; nivel?: number; rango?: number; adscripcionId?: number } }
  | { hacer: 'fija'; conceptoId: number; importe: number }
  | { hacer: 'captura'; conceptoId: number; importe: number; referencia: string }
  | { hacer: 'prestamo-nuevo'; conceptoId: number; importe: number; quincenas: number | null; beneficiario: string | null; referencia: string }
  | { hacer: 'prestamo-cambio'; plazoId: number; campos: { importeQuincenal?: number; quincenasPendientes?: number | null; activo?: boolean } };

export interface AltaExterna {
  curp: string; rfc: string; apellidoPaterno: string; apellidoMaterno?: string; nombres: string; tipoNomina: string; adscripcionId: number;
  puestoClave: string; nivel: number; rango: number; fechaAlta: string; banco?: string; cuentaBancaria?: string; pagoCheque?: boolean;
}

export interface EmpleadoPlan {
  id: number; tipoNomina: string; estado: string; puestoClave: string; nivel: number; rango: number; adscripcionId: number;
  fijos: Map<number, number>;
}
export interface ConceptoPlan { id: number; clave: number; descripcion: string; naturaleza: 'P' | 'D'; calculado: string | null; activo: boolean }
export interface PlazoPlan { id: number; conceptoId: number; importeQuincenal: number; quincenasPendientes: number | null; activo: boolean }

/** Lo que se necesita saber de SIGenom para decidir; el servicio lo consulta y aquí solo se razona. */
export interface Contexto {
  empleado: EmpleadoPlan | null;
  /** Más de una persona con esa CURP o RFC y no se sabe de qué nómina. */
  ambiguo: boolean;
  periodo: { anio: number; quincena: number; fechaInicio: string; fechaFin: string } | null;
  conceptos: Map<number, ConceptoPlan>;
  puestos: Set<string>;
  adscripciones: Set<number>;
  tabulador: Set<string>;
  plazo: PlazoPlan | null;
  /** La quincena abierta ya trae lo que pagó el sistema anterior (TXT): lo que se agregue podría duplicarse. */
  conTxt: boolean;
}

/** Subtipo de baja de SIModpersonal -> motivo de SIGenom. */
const MOTIVO_BAJA: Record<string, string> = {
  REN: 'B01', TER: 'B02', CDE: 'B02', TLE: 'B02', PCL: 'B02', DEF: 'B03', JUB: 'B04', RES: 'B05', CPL: 'B05',
};
/** Clave cuando el renglón no la trae (1TRA-I-P: 551 y 030; 1TRA-REI: 067). */
const CLAVE_INCIDENCIA: Record<string, number> = { falta: 551, retardo: 551, reintegro: 67, estimulo: 30 };

const pesos = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const num3 = (n: number) => String(n).padStart(3, '0');
const numero = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const cadena = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "2025-04-03" -> "3 abr 2025". */
const dia = (f: string) => `${Number(f.slice(8))} ${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

type Movimiento = Pick<MovimientoExterno, 'sistema' | 'externoId' | 'tipo' | 'subtipo' | 'curp' | 'rfc' | 'nombre' | 'tipoNomina' | 'anio' | 'quincena' | 'fecha' | 'datos'> & {
  ajustes?: AjustesExterno | null;
};

export function planear(m: Movimiento, c: Contexto): Plan {
  const plan: Plan = { empleadoId: c.empleado?.id ?? null, efecto: [], avisos: [], problema: null, acciones: [] };
  const falla = (texto: string): Plan => ({ ...plan, problema: texto, acciones: [] });

  if (c.ambiguo) return falla('Esa persona está en más de una nómina y el movimiento no dice en cuál.');
  if (!c.periodo) return falla('No hay quincena abierta en esa nómina.');
  if (m.anio && m.quincena) {
    const suya = m.anio * 100 + m.quincena;
    const abierta = c.periodo.anio * 100 + c.periodo.quincena;
    if (suya > abierta) return falla(`Es de la Q${String(m.quincena).padStart(2, '0')} de ${m.anio}; espera a que se abra.`);
    if (suya < abierta) plan.avisos.push(`Es de la Q${String(m.quincena).padStart(2, '0')} de ${m.anio}: se aplica en la abierta y lo atrasado se revisa aparte.`);
  }

  const esAlta = m.sistema === 'personal' && m.tipo === 'A';
  if (!c.empleado && !(esAlta && m.subtipo === 'NUE')) return falla('No se encontró a la persona en SIGenom por CURP ni RFC.');
  if (c.empleado?.estado === 'baja' && !esAlta) return falla('La persona ya está dada de baja en SIGenom.');

  const hecho = (m.sistema === 'personal' ? personal : m.sistema === 'checador' ? checador : prestamo)(m, c, plan, falla);
  if (c.conTxt && hecho.acciones.some((a) => a.hacer === 'captura' || a.hacer === 'fija' || a.hacer === 'prestamo-nuevo')) {
    hecho.avisos.unshift('Esta quincena ya trae lo que pagó el sistema anterior: revisa que no se pague o descuente dos veces.');
  }
  return hecho;
}

function personal(m: Movimiento, c: Contexto, plan: Plan, falla: (t: string) => Plan): Plan {
  const d = m.datos;
  const e = c.empleado;
  if (!m.fecha || !FECHA.test(m.fecha)) return falla('El movimiento no trae fecha.');
  if (d.documOk === 'N') plan.avisos.push('En Personal su documentación está incompleta.');

  if (m.tipo === 'B') {
    const motivo = MOTIVO_BAJA[m.subtipo ?? ''];
    if (!motivo) return falla(`No hay un motivo de SIGenom para la baja “${m.subtipo ?? 'sin subtipo'}”.`);
    plan.efecto.push(`Baja el ${dia(m.fecha)}`);
    plan.acciones.push({ hacer: 'baja', fecha: m.fecha, motivo });
    return plan;
  }

  if (m.tipo === 'L') {
    if (m.subtipo === 'CON') {
      plan.efecto.push('Licencia con goce de sueldo: no cambia el pago');
      return plan;
    }
    if (m.subtipo !== 'SIN') return falla(`Licencia “${m.subtipo ?? 'sin subtipo'}” no reconocida.`);
    const fin = FECHA.test(cadena(d.fTerm)) ? cadena(d.fTerm) : null;
    if (fin && fin < m.fecha) return falla('La licencia termina antes de empezar.');
    plan.efecto.push(`Licencia sin goce desde el ${dia(m.fecha)}${fin ? ` hasta el ${dia(fin)}` : ', sin fecha de término'}`);
    plan.acciones.push({ hacer: 'permiso', inicio: m.fecha, fin, motivo: 'P01' });
    return plan;
  }

  if (m.tipo === 'T') {
    const ads = Number(d.adsAct);
    if (!Number.isInteger(ads) || !c.adscripciones.has(ads)) return falla(`La adscripción ${cadena(d.adsAct) || 'nueva'} no está en Catálogos.`);
    if (ads === e!.adscripcionId) plan.efecto.push('Ya está en esa adscripción');
    else {
      plan.efecto.push(`Adscripción ${e!.adscripcionId} → ${ads}`);
      plan.acciones.push({ hacer: 'cambio', campos: { adscripcionId: ads } });
    }
    return plan;
  }

  if (m.tipo !== 'A' && m.tipo !== 'P') return falla(`Tipo de movimiento “${m.tipo}” no reconocido.`);

  const puesto = cadena(d.puestoClave);
  const digitos = /^.{5}(\d{2})$/.exec(puesto);
  const rango = Number(d.rango);
  if (puesto || m.tipo === 'A') {
    if (!c.puestos.has(puesto)) return falla(`El puesto ${puesto || '(vacío)'} no está en Catálogos.`);
    if (!digitos) return falla(`No se puede sacar el nivel del puesto ${puesto}.`);
    if (!Number.isInteger(rango) || !c.tabulador.has(`${Number(digitos[1])}-${rango}`)) return falla(`El nivel ${Number(digitos[1])} rango ${cadena(d.rango) || '(vacío)'} no está en el tabulador.`);
  }
  const nivel = digitos ? Number(digitos[1]) : 0;

  if (m.tipo === 'A' && m.subtipo === 'NUE' && !e) {
    const ads = Number(d.adsAct);
    if (!Number.isInteger(ads) || !c.adscripciones.has(ads)) return falla(`La adscripción ${cadena(d.adsAct) || '(vacía)'} no está en Catálogos.`);
    if (!m.curp || !m.rfc || m.rfc.length < 12) return falla('Falta la CURP o el RFC con homoclave.');
    if (!cadena(d.primerApellido) || !cadena(d.nombres)) return falla('Faltan el apellido o el nombre por separado.');
    // La cuenta que capture nómina aquí manda sobre la que trajo Personal.
    const aj = m.ajustes ?? {};
    const cuenta = cadena(aj.cuentaBancaria !== undefined ? aj.cuentaBancaria : d.ctaBan).replace(/\D/g, '');
    const cuentaValida = /^(\d{10}|\d{11}|\d{16}|\d{18})$/.test(cuenta);
    const cheque = !!aj.pagoCheque;
    const banco = cadena(aj.banco).slice(0, 20) || 'CITIBANAMEX';
    if (!cuentaValida && !cheque) plan.avisos.push('Sin cuenta bancaria: captúrala aquí antes de aplicar, o no se le podrá depositar.');
    plan.efecto.push(`Alta el ${dia(m.fecha)} · puesto ${puesto}, nivel ${nivel}, rango ${rango} · adscripción ${ads}`);
    plan.acciones.push({
      hacer: 'alta',
      datos: {
        curp: m.curp, rfc: m.rfc, apellidoPaterno: cadena(d.primerApellido), apellidoMaterno: cadena(d.segundoApellido) || undefined,
        nombres: cadena(d.nombres), tipoNomina: m.tipoNomina!, adscripcionId: ads, puestoClave: puesto, nivel, rango, fechaAlta: m.fecha,
        ...(cheque ? { pagoCheque: true } : cuentaValida ? { cuentaBancaria: cuenta, banco } : {}),
      },
    });
    plan.efecto.push(cheque ? 'Se le paga con cheque' : cuentaValida ? `Depósito a ${banco} ···${cuenta.slice(-4)}` : 'Sin forma de pago');
  } else if (m.tipo === 'A') {
    if (!e) return falla('No se encontró a la persona en SIGenom por CURP ni RFC.');
    if (e.estado === 'activo') return falla('Ya está activa en SIGenom.');
    plan.efecto.push(`Reingreso el ${dia(m.fecha)}`);
    plan.acciones.push({ hacer: 'reingreso', fecha: m.fecha });
  }

  if (e && puesto) {
    const campos: { puestoClave?: string; nivel?: number; rango?: number; adscripcionId?: number } = {};
    if (puesto !== e.puestoClave) campos.puestoClave = puesto;
    if (nivel !== e.nivel) campos.nivel = nivel;
    if (rango !== e.rango) campos.rango = rango;
    if (campos.puestoClave) plan.efecto.push(`Puesto ${e.puestoClave} → ${puesto}`);
    if (campos.nivel || campos.rango) plan.efecto.push(`Nivel ${e.nivel} rango ${e.rango} → nivel ${nivel} rango ${rango}`);
    if (m.tipo === 'A' && c.adscripciones.has(Number(d.adsAct)) && Number(d.adsAct) !== e.adscripcionId) {
      campos.adscripcionId = Number(d.adsAct);
      plan.efecto.push(`Adscripción ${e.adscripcionId} → ${campos.adscripcionId}`);
    }
    if (Object.keys(campos).length) plan.acciones.push({ hacer: 'cambio', campos });
  }

  // Percepciones: en SIModpersonal van por mes; la clave fija es por quincena. Las del tabulador no se tocan.
  for (const p of Array.isArray(d.percepciones) ? (d.percepciones as Record<string, unknown>[]) : []) {
    const clave = Number(p.cve);
    const mensual = numero(p.importe);
    if (!clave || !mensual) continue;
    const concepto = c.conceptos.get(clave);
    if (!concepto || !concepto.activo) return falla(`La clave ${num3(clave)} no está en el catálogo de esa nómina.`);
    if (concepto.calculado) continue;
    const importe = Math.round(mensual * 50) / 100;
    const antes = e?.fijos.get(concepto.id);
    if (antes === importe) continue;
    plan.efecto.push(`${num3(clave)} ${concepto.descripcion}: ${antes === undefined ? '' : `${pesos.format(antes)} → `}${pesos.format(importe)} por quincena`);
    plan.acciones.push({ hacer: 'fija', conceptoId: concepto.id, importe });
  }
  if (plan.acciones.some((a) => a.hacer === 'fija')) plan.avisos.push('Los importes de Personal venían por mes y se pasaron a quincena.');

  // Claves que nómina agrega aquí antes de aplicar (ya vienen por quincena).
  for (const k of m.ajustes?.claves ?? []) {
    const concepto = c.conceptos.get(k.clave);
    if (!concepto || !concepto.activo) return falla(`La clave ${num3(k.clave)} que agregaste no está en el catálogo de esa nómina.`);
    if (concepto.calculado) return falla(`La clave ${num3(k.clave)} la calcula el sistema; quítala.`);
    const texto = `${concepto.naturaleza === 'D' ? 'Descuenta' : 'Paga'} ${pesos.format(k.importe)} en ${num3(k.clave)} ${concepto.descripcion}`;
    if (k.cada === 'esta') {
      plan.efecto.push(`${texto}, solo esta quincena`);
      plan.acciones.push({ hacer: 'captura', conceptoId: concepto.id, importe: k.importe, referencia: `Personal folio ${cadena(d.folio) || m.externoId}`.slice(0, 80) });
    } else {
      plan.efecto.push(`${texto} cada quincena`);
      plan.acciones.push({ hacer: 'fija', conceptoId: concepto.id, importe: k.importe });
    }
  }
  if (c.periodo && m.fecha < c.periodo.fechaInicio && plan.acciones.length) plan.avisos.push(`Vale desde el ${dia(m.fecha)}: revisa si hay que pagar retroactivo.`);
  if (!plan.acciones.length) plan.efecto.push('SIGenom ya está así');
  return plan;
}

function checador(m: Movimiento, c: Contexto, plan: Plan, falla: (t: string) => Plan): Plan {
  const clave = numero(m.datos.clave) ?? CLAVE_INCIDENCIA[m.tipo];
  const importe = numero(m.datos.importe);
  if (!clave) return falla('No trae clave y ese tipo no tiene una por omisión.');
  const concepto = c.conceptos.get(clave);
  if (!concepto || !concepto.activo) return falla(`La clave ${num3(clave)} no está en el catálogo de esa nómina.`);
  if (concepto.calculado) return falla(`La clave ${num3(clave)} la calcula el sistema.`);
  if (!importe || importe <= 0) return falla('No trae un importe válido.');
  const esperada = m.tipo === 'falta' || m.tipo === 'retardo' ? 'D' : m.tipo === 'reintegro' || m.tipo === 'estimulo' ? 'P' : null;
  if (esperada && concepto.naturaleza !== esperada) return falla(`La clave ${num3(clave)} no corresponde a un ${m.tipo}.`);
  const dias = numero(m.datos.dias);
  plan.efecto.push(`${concepto.naturaleza === 'D' ? 'Descuenta' : 'Paga'} ${pesos.format(importe)} en ${num3(clave)} ${concepto.descripcion}${dias ? ` · ${dias} ${dias === 1 ? 'día' : 'días'}` : ''}`);
  plan.acciones.push({
    hacer: 'captura', conceptoId: concepto.id, importe,
    referencia: [`Checador ${m.externoId}`, m.fecha, cadena(m.datos.referencia)].filter(Boolean).join(' · ').slice(0, 80),
  });
  return plan;
}

function prestamo(m: Movimiento, c: Contexto, plan: Plan, falla: (t: string) => Plan): Plan {
  const d = m.datos;
  const folio = cadena(d.prestamo);
  if (!folio) return falla('No trae el número de préstamo.');
  const importe = numero(d.importeQuincenal);
  const quincenas = numero(d.quincenas);
  if (quincenas !== null && (!Number.isInteger(quincenas) || quincenas < 1)) return falla('El número de quincenas no es válido.');

  if (m.tipo === 'alta') {
    if (c.plazo) return falla(`El préstamo ${folio} ya está en SIGenom.`);
    const concepto = c.conceptos.get(numero(d.clave) ?? 0);
    if (!concepto || !concepto.activo || concepto.naturaleza !== 'D') return falla(`La clave ${cadena(d.clave) || '(vacía)'} no es una deducción de esa nómina.`);
    if (concepto.calculado) return falla(`La clave ${num3(concepto.clave)} la calcula el sistema.`);
    if (!importe || importe <= 0) return falla('No trae el importe por quincena.');
    plan.efecto.push(`Descuenta ${pesos.format(importe)} por quincena en ${num3(concepto.clave)} ${concepto.descripcion}${quincenas ? `, ${quincenas} quincenas` : ', sin plazo'}`);
    plan.acciones.push({ hacer: 'prestamo-nuevo', conceptoId: concepto.id, importe, quincenas, beneficiario: cadena(d.beneficiario) || null, referencia: folio });
    return plan;
  }

  if (!c.plazo) return falla(`No se encontró el préstamo ${folio} en SIGenom.`);
  if (m.tipo === 'cambio') {
    if (!importe && quincenas === null) return falla('El cambio no trae importe ni quincenas.');
    const campos: { importeQuincenal?: number; quincenasPendientes?: number } = {};
    if (importe && importe > 0) {
      campos.importeQuincenal = importe;
      plan.efecto.push(`Descuento ${pesos.format(c.plazo.importeQuincenal)} → ${pesos.format(importe)} por quincena`);
    }
    if (quincenas !== null) {
      campos.quincenasPendientes = quincenas;
      plan.efecto.push(`Quincenas pendientes ${c.plazo.quincenasPendientes ?? 'sin plazo'} → ${quincenas}`);
    }
    plan.acciones.push({ hacer: 'prestamo-cambio', plazoId: c.plazo.id, campos });
    return plan;
  }
  if (m.tipo === 'suspension' || m.tipo === 'reanudacion') {
    const activo = m.tipo === 'reanudacion';
    plan.efecto.push(activo ? 'Vuelve a descontarse' : 'Deja de descontarse hasta nuevo aviso');
    plan.acciones.push({ hacer: 'prestamo-cambio', plazoId: c.plazo.id, campos: { activo } });
    return plan;
  }
  if (m.tipo === 'liquidacion') {
    const total = numero(d.importe);
    plan.efecto.push('Termina el descuento');
    plan.acciones.push({ hacer: 'prestamo-cambio', plazoId: c.plazo.id, campos: { activo: false, quincenasPendientes: 0 } });
    if (total && total > 0) {
      plan.efecto.push(`Descuenta ${pesos.format(total)} de saldo en esta quincena`);
      plan.acciones.push({ hacer: 'captura', conceptoId: c.plazo.conceptoId, importe: total, referencia: `Liquidación de préstamo ${folio}`.slice(0, 80) });
    }
    return plan;
  }
  return falla(`Tipo de movimiento “${m.tipo}” no reconocido.`);
}
