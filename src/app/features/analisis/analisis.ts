import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import { NOMBRE_CALCULO, type DatosAnalisis } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';
import { calcularRecibos, descargarCsv, incrementoNecesario, type ReciboCalculado } from './calculo-isr';

type Pestana = 'catalogo' | 'personas' | 'quincenas' | 'clave' | 'incremento' | 'grupos' | 'tarifa' | 'como';
type Orden = 'dif-desc' | 'dif-asc' | 'nombre' | 'gravado';

interface Totales {
  recibos: number;
  percepciones: number;
  gravado: number;
  retenido: number;
  calculado: number;
}

const vacio = (): Totales => ({ recibos: 0, percepciones: 0, gravado: 0, retenido: 0, calculado: 0 });
const sumar = (t: Totales, r: ReciboCalculado) => {
  t.recibos++;
  t.percepciones += r.percepciones;
  t.gravado += r.gravado;
  t.retenido += r.isrRetenido;
  t.calculado += r.isrCalculado;
};

/**
 * Análisis de ISR sobre los recibos pagados, con la misma idea que la "Calculadora ISR Nómina" de
 * los TXT: se cambian las marcas de "Grava ISR" de las claves y todo se recalcula al instante para
 * ver cuánto ISR se debió retener, la diferencia contra lo retenido y el incremento que haría falta.
 * Las marcas son una simulación; solo cambian el catálogo si se guardan.
 */
@Component({
  selector: 'app-analisis',
  imports: [NgTemplateOutlet, FormsModule, RouterLink, Icono, ...FORMATO],
  templateUrl: './analisis.html',
  styleUrl: './analisis.scss',
})
export class Analisis {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);

  protected readonly datos = signal<DatosAnalisis | null>(null);
  protected readonly cargando = signal(true);
  protected readonly error = signal('');
  protected readonly anio = signal<number | null>(null);
  protected readonly pestana = signal<Pestana>('catalogo');
  protected readonly nombres = NOMBRE_CALCULO;

  // Filtros
  protected readonly adscripcion = signal('');
  protected readonly nivel = signal('');
  protected readonly busqueda = signal('');
  protected readonly naturaleza = signal<'P' | 'D' | ''>('P');
  protected readonly orden = signal<Orden>('dif-desc');
  protected readonly repartir = signal<'calculado' | 'retenido'>('calculado');
  protected readonly soloIncremento = signal(true);
  protected readonly bloque = signal(1);
  protected readonly porAdscripcion = signal(false);
  protected readonly persona = signal<number | null>(null);

  /** Marcas de "Grava ISR" por concepto (simulación) y su historial para deshacer. */
  protected readonly marcas = signal<Map<number, boolean>>(new Map());
  private readonly historial = signal<Map<number, boolean>[]>([]);
  protected readonly hayHistorial = computed(() => this.historial().length > 0);
  protected readonly puedeGuardar = computed(() => !!this.auth.currentUser()?.capacidades.catalogos);

  protected readonly pestanas: { clave: Pestana; titulo: string }[] = [
    { clave: 'catalogo', titulo: 'Catálogo de claves' },
    { clave: 'personas', titulo: 'Por persona' },
    { clave: 'quincenas', titulo: 'Por quincena' },
    { clave: 'clave', titulo: 'ISR por clave' },
    { clave: 'incremento', titulo: 'Incremento' },
    { clave: 'grupos', titulo: 'Grupos de sueldo' },
    { clave: 'tarifa', titulo: 'Parámetros y tarifa' },
    { clave: 'como', titulo: 'Cómo funciona' },
  ];

  // --- Derivados ---------------------------------------------------------------------------------

  protected readonly recibos = computed(() => {
    const d = this.datos();
    return d ? calcularRecibos(d, this.marcas()) : [];
  });

  /** Recibos de las personas que pasan los filtros. */
  protected readonly visibles = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const ads = this.adscripcion();
    const niv = this.nivel();
    const q = sinAcentos(this.busqueda().trim());
    const pasa = d.empleados.map(
      (e) =>
        (!ads || e.adscripcion === ads) &&
        (!niv || String(e.nivel) === niv) &&
        (!q || sinAcentos(e.nombre).includes(q) || e.rfc.toLowerCase().includes(q)),
    );
    return this.recibos().filter((r) => pasa[r.empleado]);
  });

  protected readonly adscripciones = computed(() => [...new Set(this.datos()?.empleados.map((e) => e.adscripcion))].sort());
  protected readonly niveles = computed(() => [...new Set(this.datos()?.empleados.map((e) => e.nivel))].sort((a, b) => a - b));

  protected readonly kpi = computed(() => {
    const t = vacio();
    this.visibles().forEach((r) => sumar(t, r));
    const personas = new Set(this.visibles().map((r) => r.empleado)).size;
    return { ...t, personas, diferencia: t.calculado - t.retenido };
  });

  protected readonly cambios = computed(() => {
    const d = this.datos();
    if (!d) return [];
    return d.conceptos.filter((c) => (this.marcas().get(c.id) ?? false) !== c.gravaIsr);
  });

  protected readonly catalogo = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const visibles = new Set(this.visibles().map((r) => r.indice));
    const acum = new Map<number, { veces: number; total: number }>();
    for (const [r, id, importe] of d.lineas) {
      if (!visibles.has(r)) continue;
      const a = acum.get(id) ?? { veces: 0, total: 0 };
      a.veces++;
      a.total += importe;
      acum.set(id, a);
    }
    const gravado = new Map<number, number>();
    for (const r of this.visibles()) for (const [id, g] of r.gravadoPorConcepto) gravado.set(id, (gravado.get(id) ?? 0) + g);
    const q = sinAcentos(this.busqueda().trim());
    return d.conceptos
      .filter((c) => !this.naturaleza() || c.naturaleza === this.naturaleza())
      .map((c) => {
        const a = acum.get(c.id) ?? { veces: 0, total: 0 };
        const g = gravado.get(c.id) ?? 0;
        return { ...c, marca: this.marcas().get(c.id) ?? false, cambiado: (this.marcas().get(c.id) ?? false) !== c.gravaIsr, veces: a.veces, total: a.total, gravado: g, exento: c.naturaleza === 'P' ? a.total - g : 0 };
      })
      .filter((c) => !q || sinAcentos(c.descripcion).includes(q) || String(c.clave) === q);
  });

  protected readonly personas = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const mapa = new Map<number, Totales>();
    for (const r of this.visibles()) {
      const t = mapa.get(r.empleado) ?? vacio();
      sumar(t, r);
      mapa.set(r.empleado, t);
    }
    const filas = [...mapa.entries()].map(([e, t]) => ({ empleado: e, ...d.empleados[e], ...t, diferencia: t.calculado - t.retenido }));
    const o = this.orden();
    return filas.sort((a, b) =>
      o === 'nombre' ? a.nombre.localeCompare(b.nombre) : o === 'gravado' ? b.gravado - a.gravado : o === 'dif-asc' ? a.diferencia - b.diferencia : b.diferencia - a.diferencia,
    );
  });

  protected readonly quincenas = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const mapa = new Map<number, Totales>();
    for (const r of this.visibles()) {
      const t = mapa.get(r.periodo) ?? vacio();
      sumar(t, r);
      mapa.set(r.periodo, t);
    }
    return [...mapa.entries()]
      .map(([p, t]) => ({ ...d.periodos[p], ...t, diferencia: t.calculado - t.retenido }))
      .sort((a, b) => a.quincena - b.quincena || a.tipo.localeCompare(b.tipo));
  });

  /** Reparte el ISR de cada recibo entre sus claves gravadas, en proporción a lo que grava cada una. */
  private repartido(recibos: ReciboCalculado[]) {
    const usar = this.repartir();
    const porConcepto = new Map<number, { gravado: number; isr: number }>();
    for (const r of recibos) {
      const isr = usar === 'calculado' ? r.isrCalculado : r.isrRetenido;
      for (const [id, g] of r.gravadoPorConcepto) {
        const a = porConcepto.get(id) ?? { gravado: 0, isr: 0 };
        a.gravado += g;
        a.isr += r.gravado ? (isr * g) / r.gravado : 0;
        porConcepto.set(id, a);
      }
    }
    const conceptos = new Map(this.datos()?.conceptos.map((c) => [c.id, c]));
    const total = [...porConcepto.values()].reduce((s, a) => s + a.isr, 0);
    return [...porConcepto.entries()]
      .map(([id, a]) => ({ ...conceptos.get(id)!, gravado: a.gravado, isr: Math.round(a.isr), proporcion: total ? a.isr / total : 0 }))
      .sort((a, b) => b.isr - a.isr);
  }
  protected readonly isrPorClave = computed(() => this.repartido(this.visibles()));
  protected readonly isrPorClavePersona = computed(() => {
    const p = this.persona();
    return p === null ? [] : this.repartido(this.visibles().filter((r) => r.empleado === p));
  });

  protected readonly incrementos = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const mapa = new Map<number, { incremento: number; recibos: number; con: number; retenido: number; calculado: number; percepciones: number }>();
    for (const r of this.visibles()) {
      const x = incrementoNecesario(r, d);
      const a = mapa.get(r.empleado) ?? { incremento: 0, recibos: 0, con: 0, retenido: 0, calculado: 0, percepciones: 0 };
      a.incremento += x;
      a.recibos++;
      a.con += x > 0 ? 1 : 0;
      a.retenido += r.isrRetenido;
      a.calculado += r.isrCalculado;
      a.percepciones += r.percepciones;
      mapa.set(r.empleado, a);
    }
    return [...mapa.entries()]
      .map(([e, a]) => ({ empleado: e, ...d.empleados[e], ...a, porcentaje: a.percepciones ? a.incremento / a.percepciones : 0 }))
      .filter((f) => !this.soloIncremento() || f.incremento > 0)
      .sort((a, b) => b.incremento - a.incremento);
  });
  protected readonly totalIncremento = computed(() => this.incrementos().reduce((s, f) => s + f.incremento, 0));
  protected readonly detalleIncremento = computed(() => {
    const d = this.datos();
    const p = this.persona();
    if (!d || p === null) return [];
    return this.visibles()
      .filter((r) => r.empleado === p)
      .map((r) => ({ ...d.periodos[r.periodo], r, incremento: incrementoNecesario(r, d) }));
  });

  /** Sueldo mensual (sueldo + compensación del tabulador) de la última nómina de cada persona. */
  protected readonly grupos = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const base = new Set(d.conceptos.filter((c) => c.calculado === 'sueldo' || c.calculado === 'compensacion').map((c) => c.id));
    const sueldoRecibo = new Map<number, number>();
    for (const [r, id, importe] of d.lineas) if (base.has(id)) sueldoRecibo.set(r, (sueldoRecibo.get(r) ?? 0) + importe);
    const ultimo = new Map<number, ReciboCalculado>();
    for (const r of this.visibles()) {
      if (r.tipo !== 'nomina') continue;
      const previo = ultimo.get(r.empleado);
      if (!previo || d.periodos[r.periodo].quincena > d.periodos[previo.periodo].quincena) ultimo.set(r.empleado, r);
    }
    const tam = Math.max(1, this.bloque());
    const grupos = new Map<string, { titulo: string; adscripcion: string; desde: number; personas: { nombre: string; nivel: number; mensual: number }[] }>();
    for (const [e, r] of ultimo) {
      const emp = d.empleados[e];
      const dias = d.recibos[r.indice].dias || d.parametros.diasQuincena;
      // Lo de la quincena llevado a quincena completa y a mes.
      const mensual = Math.round(((sueldoRecibo.get(r.indice) ?? 0) / dias) * d.parametros.diasQuincena * 2);
      const desde = Math.floor((emp.nivel - 1) / tam) * tam + 1;
      const ads = this.porAdscripcion() ? emp.adscripcion : '';
      const clave = `${ads}|${desde}`;
      const titulo = tam === 1 ? `Nivel ${desde}` : `Niveles ${desde} a ${desde + tam - 1}`;
      const g = grupos.get(clave) ?? { titulo, adscripcion: ads, desde, personas: [] };
      g.personas.push({ nombre: emp.nombre, nivel: emp.nivel, mensual });
      grupos.set(clave, g);
    }
    return [...grupos.values()]
      .map((g) => {
        const montos = g.personas.map((p) => p.mensual);
        const min = Math.min(...montos);
        const max = Math.max(...montos);
        return { ...g, min, max, promedio: Math.round(montos.reduce((s, m) => s + m, 0) / montos.length), dispersion: min ? (max - min) / min : 0 };
      })
      .sort((a, b) => a.adscripcion.localeCompare(b.adscripcion) || a.desde - b.desde);
  });
  protected readonly grupoAbierto = signal<string | null>(null);

  constructor() {
    effect(() => {
      const tipo = this.contexto.tipoNomina();
      const anio = this.anio();
      untracked(() => this.cargar(tipo, anio ?? undefined));
    });
  }

  private cargar(tipo: string, anio?: number): void {
    this.cargando.set(true);
    this.error.set('');
    this.api.analisis(tipo, anio).subscribe({
      next: (d) => {
        this.datos.set(d);
        if (this.anio() === null) this.anio.set(d.anio);
        this.marcas.set(this.marcasIniciales(d));
        this.historial.set([]);
        this.persona.set(null);
        this.cargando.set(false);
      },
      error: (e) => {
        this.error.set(mensajeDeError(e));
        this.cargando.set(false);
      },
    });
  }

  // --- Marcas ------------------------------------------------------------------------------------

  protected marcar(id: number, valor: boolean): void {
    this.cambiarMarcas((m) => m.set(id, valor));
  }

  /** Marca o desmarca de una vez las percepciones que se ven en la tabla del catálogo. */
  protected marcarTodas(valor: boolean): void {
    const ids = this.catalogo().filter((c) => c.naturaleza === 'P').map((c) => c.id);
    this.cambiarMarcas((m) => ids.forEach((id) => m.set(id, valor)));
  }

  protected deshacer(): void {
    const pila = this.historial();
    if (!pila.length) return;
    this.marcas.set(pila[pila.length - 1]);
    this.historial.set(pila.slice(0, -1));
    this.guardarLocal();
  }

  protected restablecer(): void {
    const d = this.datos();
    if (!d) return;
    this.cambiarMarcas((m) => d.conceptos.forEach((c) => m.set(c.id, c.gravaIsr)));
  }

  private cambiarMarcas(cambio: (m: Map<number, boolean>) => void): void {
    this.historial.update((h) => [...h.slice(-30), new Map(this.marcas())]);
    const nuevas = new Map(this.marcas());
    cambio(nuevas);
    this.marcas.set(nuevas);
    this.guardarLocal();
  }

  /** Lleva las marcas simuladas al catálogo de conceptos: desde la siguiente nómina se calculan así. */
  protected async guardarEnCatalogo(): Promise<void> {
    const cambios = this.cambios();
    const tipo = this.contexto.tipoNomina();
    if (!cambios.length) return;
    const ok = await this.avisos.confirmar({
      titulo: `Guardar ${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'} en el catálogo`,
      texto: `${cambios.map((c) => `${c.clave} ${c.descripcion}: ${this.marcas().get(c.id) ? 'grava' : 'no grava'}`).join(' · ')}. Aplica desde el siguiente cálculo; los recibos ya pagados no cambian.`,
      accion: 'Guardar en el catálogo',
    });
    if (!ok) return;
    this.api.catalogo('conceptos', tipo).subscribe((filas) => {
      const peticiones = cambios.map((c) => {
        const fila = filas.find((f) => f['id'] === c.id) ?? {};
        return this.api.guardarRenglon('conceptos', { ...fila, gravaIsr: this.marcas().get(c.id) ?? false }, String(c.id));
      });
      forkJoin(peticiones).subscribe({
        next: () => {
          this.avisos.exito('Catálogo actualizado.');
          this.limpiarLocal();
          this.cargar(tipo, this.anio() ?? undefined);
        },
        error: (e) => this.avisos.error(mensajeDeError(e)),
      });
    });
  }

  private claveLocal(): string {
    return `sigenom_analisis_${this.contexto.tipoNomina()}`;
  }

  private marcasIniciales(d: DatosAnalisis): Map<number, boolean> {
    const m = new Map(d.conceptos.map((c) => [c.id, c.gravaIsr] as [number, boolean]));
    try {
      const guardadas = JSON.parse(localStorage.getItem(this.claveLocal()) ?? '{}') as Record<string, boolean>;
      for (const [id, v] of Object.entries(guardadas)) if (m.has(Number(id))) m.set(Number(id), v);
    } catch {
      // Sin almacenamiento se empieza con el catálogo.
    }
    return m;
  }

  private guardarLocal(): void {
    const d = this.datos();
    if (!d) return;
    const distintas = Object.fromEntries(d.conceptos.filter((c) => (this.marcas().get(c.id) ?? false) !== c.gravaIsr).map((c) => [c.id, this.marcas().get(c.id)]));
    try {
      localStorage.setItem(this.claveLocal(), JSON.stringify(distintas));
    } catch {
      // Se pierde al recargar; no pasa nada.
    }
  }

  private limpiarLocal(): void {
    try {
      localStorage.removeItem(this.claveLocal());
    } catch {
      // Nada que limpiar.
    }
  }

  protected quitarFiltros(): void {
    this.adscripcion.set('');
    this.nivel.set('');
    this.busqueda.set('');
  }

  // --- Exportar ----------------------------------------------------------------------------------

  protected exportar(): void {
    const pesos = (c: number) => Math.round(c) / 100;
    const sufijo = `${this.contexto.tipoNomina()}-${this.anio()}`;
    switch (this.pestana()) {
      case 'catalogo':
        return descargarCsv(`catalogo-claves-${sufijo}.csv`, ['Clave', 'Descripción', 'Tipo', 'Grava ISR', 'Veces', 'Importe total', 'Exento', 'Gravado'],
          this.catalogo().map((c) => [c.clave, c.descripcion, c.naturaleza === 'P' ? 'Percepción' : 'Deducción', c.marca ? 'Sí' : 'No', c.veces, pesos(c.total), pesos(c.exento), pesos(c.gravado)]));
      case 'personas':
        return descargarCsv(`isr-por-persona-${sufijo}.csv`, ['RFC', 'Nombre', 'Adscripción', 'Nivel', 'Recibos', 'Percepciones', 'Gravado', 'ISR retenido', 'ISR calculado', 'Diferencia'],
          this.personas().map((p) => [p.rfc, p.nombre, p.adscripcion, p.nivel, p.recibos, pesos(p.percepciones), pesos(p.gravado), pesos(p.retenido), pesos(p.calculado), pesos(p.diferencia)]));
      case 'quincenas':
        return descargarCsv(`isr-por-quincena-${sufijo}.csv`, ['Quincena', 'Tipo', 'Recibos', 'Percepciones', 'Gravado', 'ISR retenido', 'ISR calculado', 'Diferencia'],
          this.quincenas().map((q) => [q.quincena, this.nombres[q.tipo], q.recibos, pesos(q.percepciones), pesos(q.gravado), pesos(q.retenido), pesos(q.calculado), pesos(q.diferencia)]));
      case 'clave':
        return descargarCsv(`isr-por-clave-${sufijo}.csv`, ['Clave', 'Descripción', 'Gravado', `ISR ${this.repartir()}`, 'Proporción'],
          this.isrPorClave().map((c) => [c.clave, c.descripcion, pesos(c.gravado), pesos(c.isr), Math.round(c.proporcion * 10000) / 100]));
      case 'incremento':
        return descargarCsv(`incremento-${sufijo}.csv`, ['RFC', 'Nombre', 'Adscripción', 'Recibos', 'Recibos con incremento', 'ISR retenido', 'ISR calculado', 'Incremento necesario', '% sobre percepciones'],
          this.incrementos().map((f) => [f.rfc, f.nombre, f.adscripcion, f.recibos, f.con, pesos(f.retenido), pesos(f.calculado), pesos(f.incremento), Math.round(f.porcentaje * 10000) / 100]));
      case 'grupos':
        return descargarCsv(`grupos-de-sueldo-${sufijo}.csv`, ['Adscripción', 'Grupo', 'Personas', 'Mínimo mensual', 'Promedio', 'Máximo', 'Dispersión %'],
          this.grupos().map((g) => [g.adscripcion || 'Todas', g.titulo, g.personas.length, pesos(g.min), pesos(g.promedio), pesos(g.max), Math.round(g.dispersion * 10000) / 100]));
      default:
        return;
    }
  }
}

function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
