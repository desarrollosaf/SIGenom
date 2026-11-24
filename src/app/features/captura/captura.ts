import { Component, computed, effect, ElementRef, inject, signal, viewChild, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { Captura, ConceptoOpcion, EmpleadoResumen } from '../../core/services/modelos';
import { BuscarClave } from '../../shared/buscar-clave/buscar-clave';
import { BuscarEmpleado } from '../../shared/buscar-empleado/buscar-empleado';
import { Cajon } from '../../shared/cajon/cajon';
import { FORMATO } from '../../shared/formato';
import { MarcasClave } from '../../shared/marcas-clave/marcas-clave';
import { Icono } from '../../shared/icono/icono';

/**
 * Captura quincenal (1CAP-Q-N.W): todo lo que solo aplica en esta quincena, a mano. Lo que viene de
 * otros sistemas (personal, checadores, préstamos) entra por Otros sistemas.
 */
@Component({
  selector: 'app-captura',
  imports: [FormsModule, RouterLink, Icono, BuscarClave, BuscarEmpleado, Cajon, MarcasClave, ...FORMATO],
  templateUrl: './captura.html',
  styleUrl: './captura.scss',
})
export class CapturaPagina {
  /** Dentro del asistente de Proceso de nómina: sin encabezado de página. */
  readonly incrustado = input(false);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly contexto = inject(ContextoService);
  private readonly auth = inject(AuthService);
  protected readonly puede = computed(() => !!this.auth.currentUser()?.capacidades.capturar && this.contexto.abierto());
  private readonly campoImporte = viewChild<ElementRef<HTMLInputElement>>('importe');

  protected readonly capturas = signal<Captura[]>([]);
  protected readonly origenes = signal<{ clave: string; nombre: string; sistema: boolean }[]>([]);
  protected readonly empleado = signal<EmpleadoResumen | null>(null);
  protected readonly filtro = signal('');
  protected readonly filtroOrigen = signal('');
  protected readonly guardando = signal(false);
  /** Captura a la que se le cambian las marcas. */
  protected readonly marcando = signal<{ captura: Captura; gravaIsr: boolean | null; timbra: boolean | null } | null>(null);

  protected nueva = this.vacia();

  protected readonly capturables = computed(() => this.contexto.conceptos().filter((c) => !c.calculado));
  /** Una quincena puede traer más de 10 mil movimientos: el filtro y los totales los resuelve el servidor. */
  protected readonly visibles = computed(() => this.capturas());
  protected readonly totales = signal({ total: 0, personas: 0, p: 0, d: 0 });
  /** Lo capturado a la persona elegida, para ver de un vistazo qué ya tiene. */
  protected readonly delEmpleado = signal<Captura[]>([]);
  private espera: ReturnType<typeof setTimeout> | null = null;
  protected readonly nombreOrigen = computed(() => new Map(this.origenes().map((o) => [o.clave, o.nombre.split(' (')[0]])));

  constructor() {
    this.api.origenes().subscribe((o) => this.origenes.set(o));
    effect(() => {
      const p = this.contexto.periodo();
      this.empleado.set(null);
      if (!p) this.capturas.set([]);
    });
    // Lista y totales con el filtro; se espera a que termine de escribir.
    effect(() => {
      const p = this.contexto.periodo();
      const filtro = { q: this.filtro().trim(), origen: this.filtroOrigen() };
      if (this.espera) clearTimeout(this.espera);
      if (p) this.espera = setTimeout(() => this.cargar(p.id, filtro), filtro.q ? 300 : 0);
    });
    effect(() => {
      const p = this.contexto.periodo();
      const e = this.empleado();
      if (p && e) this.api.capturas(p.id, { empleadoId: e.id }).subscribe((c) => this.delEmpleado.set(c));
      else this.delEmpleado.set([]);
    });
  }

  private cargar(periodoId: number, filtro = { q: this.filtro().trim(), origen: this.filtroOrigen() }): void {
    const fallo = (x: unknown) => this.avisos.error(mensajeDeError(x));
    this.api.capturas(periodoId, filtro).subscribe({ next: (c) => this.capturas.set(c), error: fallo });
    this.api.resumenCapturas(periodoId, filtro).subscribe({ next: (r) => this.totales.set(r), error: fallo });
    const e = this.empleado();
    if (e) this.api.capturas(periodoId, { empleadoId: e.id }).subscribe((c) => this.delEmpleado.set(c));
  }

  protected elegir(e: EmpleadoResumen): void {
    this.empleado.set(e);
    this.nueva = this.vacia(this.nueva.conceptoId);
    setTimeout(() => document.getElementById('concepto')?.focus());
  }

  protected agregar(): void {
    const p = this.contexto.periodo();
    const e = this.empleado();
    if (!p || !e || !this.nueva.conceptoId || !this.nueva.importe || this.guardando()) return;
    this.guardando.set(true);
    this.api
      .capturar(p.id, { empleadoId: e.id, conceptoId: this.nueva.conceptoId, importe: this.nueva.importe, referencia: this.nueva.referencia || undefined, gravaIsr: this.nueva.gravaIsr, timbra: this.nueva.timbra })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.nueva = this.vacia(this.nueva.conceptoId);
          this.cargar(p.id);
          this.campoImporte()?.nativeElement.focus();
        },
        error: (err) => {
          this.guardando.set(false);
          this.avisos.error(mensajeDeError(err));
        },
      });
  }

  private vacia(conceptoId: number | null = null) {
    return { conceptoId, importe: null as number | null, referencia: '', gravaIsr: null as boolean | null, timbra: null as boolean | null };
  }

  /** Lo que aplica a una captura ya hecha, con su marca o la del catálogo. */
  protected clave(id: number | null): ConceptoOpcion | null {
    return this.contexto.conceptos().find((c) => c.id === id) ?? null;
  }

  protected editarMarcas(c: Captura): void {
    this.marcando.set({ captura: c, gravaIsr: c.gravaIsr, timbra: c.timbra });
  }

  protected guardarMarcas(): void {
    const m = this.marcando();
    if (!m || this.guardando()) return;
    this.guardando.set(true);
    this.api.marcarCaptura(m.captura.id, { gravaIsr: m.gravaIsr, timbra: m.timbra }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.marcando.set(null);
        this.avisos.exito('Guardado. Vuelve a calcular para que se refleje.');
        this.cargar(this.contexto.periodo()!.id);
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }

  protected async borrar(c: Captura): Promise<void> {
    const ok = await this.avisos.confirmar({ titulo: 'Borrar captura', texto: `${c.concepto} de ${c.nombre} por ${c.importe.toFixed(2)}.`, accion: 'Borrar', peligro: true });
    if (!ok) return;
    this.api.borrarCaptura(c.id).subscribe({
      next: () => this.cargar(this.contexto.periodo()!.id),
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }
}
