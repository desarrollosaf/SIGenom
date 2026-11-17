import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { Calculo, Captura, Diagnostico, PeriodoDetalle, ReciboFila, TipoCalculo } from '../../core/services/modelos';
import { CapturaPagina } from '../captura/captura';
import { Pagos } from '../pagos/pagos';
import { Verificacion } from '../verificacion/verificacion';
import { FORMATO } from '../../shared/formato';
import { Icono, NombreIcono } from '../../shared/icono/icono';

type ClavePaso = 'captura' | 'prenomina' | 'verificacion' | 'nomina' | 'pago' | 'cierre';
type EstadoPaso = 'hecho' | 'actual' | 'pendiente';

interface Paso {
  clave: ClavePaso;
  titulo: string;
  subtitulo: string;
  icono: NombreIcono;
}

const PASOS: Paso[] = [
  { clave: 'captura', titulo: 'Captura', subtitulo: 'Lo que solo aplica en esta quincena', icono: 'captura' },
  { clave: 'prenomina', titulo: 'Prenómina', subtitulo: 'Cálculo de revisión', icono: 'calculo' },
  { clave: 'verificacion', titulo: 'Verificación', subtitulo: 'Revisar antes de pagar', icono: 'verificar' },
  { clave: 'nomina', titulo: 'Nómina', subtitulo: 'Cálculo definitivo', icono: 'listo' },
  { clave: 'pago', titulo: 'Pago', subtitulo: 'Archivo del banco y comprobantes', icono: 'banco' },
  { clave: 'cierre', titulo: 'Cierre', subtitulo: 'Guardar y abrir la siguiente', icono: 'candado' },
];

/**
 * El ciclo de la quincena en una sola pantalla, paso a paso: lo que antes había que recordar entre
 * Captura, Cálculo, Verificación, Pagos y Quincenas. Cada paso dice si está bien, qué falta y qué sigue.
 */
@Component({
  selector: 'app-proceso',
  imports: [NgTemplateOutlet, RouterLink, Icono, CapturaPagina, Verificacion, Pagos, ...FORMATO],
  templateUrl: './proceso.html',
  styleUrl: './proceso.scss',
})
export class Proceso {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);

  protected readonly pasos = PASOS;
  protected readonly detalle = signal<PeriodoDetalle | null>(null);
  protected readonly capturas = signal<Captura[]>([]);
  protected readonly diagnosticos = signal<Diagnostico[] | null>(null);
  protected readonly observados = signal<ReciboFila[]>([]);
  protected readonly activo = signal<ClavePaso>('captura');
  protected readonly enviando = signal(false);
  /** Pasos que no dejan huella en la base y que la persona dio por buenos con "Continuar". */
  protected readonly vistos = signal<Set<ClavePaso>>(new Set());
  /** La quincena que se acaba de cerrar, para la pantalla de felicitación. */
  protected readonly recienCerrada = signal<{ nombre: string; neto: number; recibos: number } | null>(null);

  protected readonly puedeCalcular = computed(() => !!this.auth.currentUser()?.capacidades.calcular);
  protected readonly puedeCerrar = computed(() => !!this.auth.currentUser()?.capacidades.cerrar);

  private ultimo(tipo: TipoCalculo) {
    return this.detalle()?.calculos.find((c) => c.tipo === tipo && c.estado === 'terminado') ?? null;
  }
  protected readonly prenomina = computed(() => this.ultimo('prenomina'));
  protected readonly nomina = computed(() => this.ultimo('nomina'));
  protected readonly enCurso = computed(
    () => this.detalle()?.calculos.find((c) => c.estado === 'en_cola' || c.estado === 'procesando') ?? null,
  );
  protected readonly fallido = computed(() => {
    const ultimo = this.detalle()?.calculos[0];
    return ultimo?.estado === 'error' ? ultimo : null;
  });

  /** Capturas hechas después de un cálculo: ese cálculo ya no refleja todo. */
  private capturasDespues(calculo: Calculo | null) {
    if (!calculo) return 0;
    const desde = Date.parse(calculo.iniciadoEl ?? calculo.creadoEl);
    return this.capturas().filter((c) => Date.parse(c.creadoEl) > desde).length;
  }
  protected readonly prenominaVieja = computed(() => this.capturasDespues(this.prenomina()));
  protected readonly nominaVieja = computed(() => this.capturasDespues(this.nomina()));

  protected readonly resumenCaptura = computed(() => {
    const l = this.capturas();
    const suma = (n: 'P' | 'D') => l.filter((c) => c.naturaleza === n).reduce((s, c) => s + c.importe, 0);
    return { total: l.length, personas: new Set(l.map((c) => c.empleadoId)).size, p: suma('P'), d: suma('D') };
  });
  protected readonly resumenDiag = computed(() => {
    const d = this.diagnosticos() ?? [];
    return {
      errores: d.filter((x) => x.severidad === 'error' && x.total),
      avisos: d.filter((x) => x.severidad === 'aviso' && x.total),
    };
  });

  /** Qué pasos están cumplidos según lo que hay en la base. */
  protected readonly cumplidos = computed(() => {
    const v = this.vistos();
    const hecho = new Set<ClavePaso>();
    const pre = !!this.prenomina() && !this.prenominaVieja();
    const nom = !!this.nomina() && !this.nominaVieja();
    if (pre || nom || v.has('captura')) hecho.add('captura');
    if (pre || nom) hecho.add('prenomina');
    if (nom || v.has('verificacion')) hecho.add('verificacion');
    if (nom) hecho.add('nomina');
    if (nom && v.has('pago')) hecho.add('pago');
    if (this.detalle()?.estado === 'cerrado') PASOS.forEach((p) => hecho.add(p.clave));
    return hecho;
  });

  /** El primer paso sin cumplir: a donde lleva "Continuar" y hasta donde se puede saltar. */
  protected readonly sugerido = computed<ClavePaso>(
    () => PASOS.find((p) => !this.cumplidos().has(p.clave))?.clave ?? 'cierre',
  );
  protected readonly indice = computed(() => PASOS.findIndex((p) => p.clave === this.activo()));
  protected readonly avance = computed(() => Math.round((this.cumplidos().size / PASOS.length) * 100));

  constructor() {
    // Cambió la nómina o la quincena: se recarga todo y se va al paso que toca.
    effect(() => {
      const p = this.contexto.periodo();
      untracked(() => {
        this.vistos.set(this.leerVistos(p?.id));
        if (p) this.cargar(p.id, true);
        else this.detalle.set(null);
      });
    });
    const temporizador = setInterval(() => this.vigilar(), 1500);
    inject(DestroyRef).onDestroy(() => clearInterval(temporizador));
  }

  protected estado(clave: ClavePaso): EstadoPaso {
    if (clave === this.activo()) return 'actual';
    return this.cumplidos().has(clave) ? 'hecho' : 'pendiente';
  }

  /** Se puede ir a cualquier paso cumplido y al siguiente que toca; no se salta hacia adelante. */
  protected disponible(clave: ClavePaso): boolean {
    const i = PASOS.findIndex((p) => p.clave === clave);
    const tope = PASOS.findIndex((p) => p.clave === this.sugerido());
    return i <= tope || this.cumplidos().has(clave);
  }

  protected ir(clave: ClavePaso): void {
    if (!this.disponible(clave)) return;
    this.activo.set(clave);
    if (clave === 'verificacion' || clave === 'cierre') this.cargarDiagnosticos();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected anterior(): void {
    const i = this.indice();
    if (i > 0) this.ir(PASOS[i - 1].clave);
  }

  /** Marca el paso como revisado y pasa al siguiente. */
  protected continuar(): void {
    const actual = this.activo();
    if (actual === 'captura' || actual === 'verificacion' || actual === 'pago') this.marcarVisto(actual);
    const i = this.indice();
    if (i < PASOS.length - 1) this.ir(PASOS[i + 1].clave);
  }

  protected calcular(tipo: TipoCalculo): void {
    const p = this.contexto.periodo();
    if (!p || this.enviando()) return;
    this.enviando.set(true);
    this.api.calcular(p.id, tipo).subscribe({
      next: () => {
        this.enviando.set(false);
        this.cargar(p.id);
      },
      error: (e) => {
        this.enviando.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }

  protected async cerrar(): Promise<void> {
    const d = this.detalle();
    const nomina = this.nomina();
    if (!d || !nomina) return;
    const ok = await this.avisos.confirmar({
      titulo: `Cerrar la ${d.nombre}`,
      texto: 'Ya no se podrá capturar ni recalcular. Se descuenta una quincena a los descuentos a plazo y se abre la siguiente.',
      accion: 'Cerrar quincena',
    });
    if (!ok) return;
    this.enviando.set(true);
    this.api.cerrarPeriodo(d.id).subscribe({
      next: () => {
        this.enviando.set(false);
        this.recienCerrada.set({ nombre: d.nombre, neto: nomina.totalNeto, recibos: nomina.totalEmpleados });
        this.contexto.recargarPeriodo();
      },
      error: (e) => {
        this.enviando.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }

  protected empezarSiguiente(): void {
    this.recienCerrada.set(null);
    this.activo.set('captura');
  }

  protected porcentaje(c: Calculo): number {
    return c.totalEmpleados ? Math.round((c.procesados / c.totalEmpleados) * 100) : 0;
  }

  private cargar(periodoId: number, irAlSugerido = false): void {
    this.api.periodo(periodoId).subscribe((d) => {
      this.detalle.set(d);
      this.api.capturas(periodoId).subscribe((c) => {
        this.capturas.set(c);
        if (irAlSugerido) this.activo.set(this.sugerido());
      });
      const calculo = d.calculos.find((c) => c.estado === 'terminado' && (c.tipo === 'nomina' || c.tipo === 'prenomina'));
      if (calculo) this.api.recibos(calculo.id, { observados: true, limite: 8 }).subscribe((r) => this.observados.set(r.recibos));
      else this.observados.set([]);
    });
    this.cargarDiagnosticos();
  }

  private cargarDiagnosticos(): void {
    const p = this.contexto.periodo();
    if (p) this.api.diagnosticos(p.id).subscribe((r) => this.diagnosticos.set(r.diagnosticos));
  }

  /** Mientras el worker calcula, pregunta el avance; al terminar avisa y avanza solo. */
  private vigilar(): void {
    const curso = this.enCurso();
    if (!curso) return;
    this.api.calculo(curso.id).subscribe((c) => {
      this.detalle.update((d) => (d ? { ...d, calculos: d.calculos.map((x) => (x.id === c.id ? c : x)) } : d));
      if (c.estado === 'terminado') {
        this.avisos.exito(`${c.tipo === 'nomina' ? 'Nómina' : 'Prenómina'} calculada: ${c.totalEmpleados} recibos.`);
        this.contexto.recargarPeriodo();
        this.cargar(c.periodoId);
      } else if (c.estado === 'error') {
        this.avisos.error(`El cálculo falló: ${c.error}`);
        this.cargar(c.periodoId);
      }
    });
  }

  private marcarVisto(clave: ClavePaso): void {
    const nuevos = new Set(this.vistos()).add(clave);
    this.vistos.set(nuevos);
    try {
      localStorage.setItem(`sigenom_proceso_${this.contexto.periodo()?.id}`, JSON.stringify([...nuevos]));
    } catch {
      // Sin almacenamiento solo se recuerda mientras la pantalla esté abierta.
    }
  }

  private leerVistos(periodoId?: number): Set<ClavePaso> {
    try {
      return new Set(JSON.parse(localStorage.getItem(`sigenom_proceso_${periodoId}`) ?? '[]'));
    } catch {
      return new Set();
    }
  }
}
