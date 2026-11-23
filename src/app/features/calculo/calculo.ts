import { Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import { guardarArchivo } from '../../core/services/descarga';
import { NOMBRE_CALCULO, type Calculo, type ReciboFila, type TipoCalculo } from '../../core/services/modelos';
import { Cajon } from '../../shared/cajon/cajon';
import { FORMATO } from '../../shared/formato';
import { Icono, NombreIcono } from '../../shared/icono/icono';
import { Recibo } from '../../shared/recibo/recibo';
import { AjustesQuincena } from './ajustes-quincena';

const POR_PAGINA = 50;

/** Cálculo de prenómina y nómina (1CAL-N-P.W), aguinaldo y prima (1CAL-A-P.W) y revisión de recibos. */
@Component({
  selector: 'app-calculo',
  imports: [FormsModule, RouterLink, Icono, Cajon, Recibo, AjustesQuincena, ...FORMATO],
  templateUrl: './calculo.html',
  styleUrl: './calculo.scss',
})
export class CalculoPagina {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);

  protected readonly calculos = signal<Calculo[]>([]);
  protected readonly elegido = signal<number | null>(null);
  protected readonly recibos = signal<ReciboFila[]>([]);
  protected readonly totalRecibos = signal(0);
  protected readonly q = signal('');
  protected readonly observados = signal(false);
  protected readonly pagina = signal(0);
  protected readonly reciboAbierto = signal<number | null>(null);
  protected readonly enviando = signal(false);
  protected readonly nombres = NOMBRE_CALCULO;

  protected readonly puede = computed(() => !!this.auth.currentUser()?.capacidades.calcular && this.contexto.abierto());
  protected readonly enCurso = computed(() => this.calculos().find((c) => c.estado === 'en_cola' || c.estado === 'procesando') ?? null);
  protected readonly actual = computed(() => this.calculos().find((c) => c.id === this.elegido()) ?? null);
  protected readonly paginas = computed(() => Math.max(1, Math.ceil(this.totalRecibos() / POR_PAGINA)));
  protected readonly hayPrenomina = computed(() => this.calculos().some((c) => c.tipo === 'prenomina' && c.estado === 'terminado'));

  protected readonly opciones = computed<{ tipo: TipoCalculo; titulo: string; texto: string; icono: NombreIcono; bloqueo: string | null }[]>(() => [
    { tipo: 'prenomina', titulo: 'Prenómina', texto: 'Cálculo de revisión. Se puede repetir las veces que haga falta.', icono: 'calculo', bloqueo: null },
    {
      tipo: 'nomina',
      titulo: 'Nómina definitiva',
      texto: 'La que se paga y se dispersa. Pide una prenómina antes.',
      icono: 'listo',
      bloqueo: this.hayPrenomina() || this.contexto.periodo()?.estado !== 'captura' ? null : 'Calcula primero la prenómina',
    },
    { tipo: 'aguinaldo', titulo: 'Aguinaldo', texto: 'Proporcional a los días trabajados en el año; exenta 30 UMA.', icono: 'calendario', bloqueo: null },
    { tipo: 'prima_vacacional', titulo: 'Prima vacacional', texto: 'Días de vacaciones por el porcentaje de prima; exenta 15 UMA.', icono: 'sol', bloqueo: null },
  ]);

  private temporizador: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const p = this.contexto.periodo();
      this.elegido.set(null);
      if (p) this.cargarCalculos(p.id, true);
      else this.calculos.set([]);
    });
    effect(() => {
      const id = this.elegido();
      const filtro = { q: this.q(), observados: this.observados() || undefined, limite: POR_PAGINA, desde: this.pagina() * POR_PAGINA };
      if (id && this.actual()?.estado === 'terminado') this.cargarRecibos(id, filtro);
      else this.recibos.set([]);
    });
    inject(DestroyRef).onDestroy(() => this.detener());
  }

  protected calcular(tipo: TipoCalculo): void {
    const p = this.contexto.periodo();
    if (!p || this.enviando()) return;
    this.enviando.set(true);
    this.api.calcular(p.id, tipo).subscribe({
      next: (c) => {
        this.enviando.set(false);
        this.calculos.update((l) => [c, ...l]);
        this.vigilar();
      },
      error: (e) => {
        this.enviando.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }

  protected elegir(id: number): void {
    this.elegido.set(id);
    this.pagina.set(0);
  }

  protected filtrar(valor: string): void {
    this.q.set(valor);
    this.pagina.set(0);
  }

  protected comprobantes(): void {
    const c = this.actual();
    if (!c) return;
    this.avisos.exito('Generando los comprobantes en PDF…');
    this.api.archivo(`calculos/${c.id}/recibos.pdf`).subscribe({
      next: (blob) => guardarArchivo(blob, `comprobantes-${this.contexto.periodo()?.anio}-q${this.contexto.periodo()?.quincena}-${c.tipo}.pdf`),
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }

  protected porcentaje(c: Calculo): number {
    return c.totalEmpleados ? Math.round((c.procesados / c.totalEmpleados) * 100) : 0;
  }

  private cargarCalculos(periodoId: number, elegirUltimo = false): void {
    this.api.periodo(periodoId).subscribe((p) => {
      this.calculos.set(p.calculos);
      if (elegirUltimo || !this.elegido()) {
        const ultimo = p.calculos.find((c) => c.estado === 'terminado');
        if (ultimo) this.elegido.set(ultimo.id);
      }
      if (p.calculos.some((c) => c.estado === 'en_cola' || c.estado === 'procesando')) this.vigilar();
    });
  }

  /** Pregunta el avance cada segundo y medio mientras el worker trabaja. */
  private vigilar(): void {
    if (this.temporizador) return;
    this.temporizador = setInterval(() => {
      const curso = this.enCurso();
      if (!curso) return this.detener();
      this.api.calculo(curso.id).subscribe((c) => {
        this.calculos.update((l) => l.map((x) => (x.id === c.id ? c : x)));
        if (c.estado === 'terminado' || c.estado === 'error') {
          this.detener();
          if (c.estado === 'terminado') {
            this.avisos.exito(`${this.nombres[c.tipo]} calculada: ${c.totalEmpleados} recibos.`);
            this.contexto.recargarPeriodo();
            this.cargarCalculos(c.periodoId);
            this.elegido.set(c.id);
          } else {
            this.avisos.error(`El cálculo falló: ${c.error}`);
          }
        }
      });
    }, 1500);
  }

  private detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  private cargarRecibos(id: number, filtro: Parameters<ApiService['recibos']>[1]): void {
    this.api.recibos(id, filtro).subscribe((r) => {
      this.recibos.set(r.recibos);
      this.totalRecibos.set(r.total);
    });
  }
}
