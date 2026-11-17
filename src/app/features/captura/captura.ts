import { Component, computed, effect, ElementRef, inject, signal, viewChild, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { Captura, EmpleadoResumen } from '../../core/services/modelos';
import { BuscarEmpleado } from '../../shared/buscar-empleado/buscar-empleado';
import { FORMATO } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';

/**
 * Captura quincenal (1CAP-Q-N.W) y traspasos (1TRA-I-P, 1TRA-REI, 1TRA-D-C): todo lo que solo
 * aplica en esta quincena, a mano o desde un archivo.
 */
@Component({
  selector: 'app-captura',
  imports: [FormsModule, RouterLink, Icono, BuscarEmpleado, ...FORMATO],
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
  protected readonly origenes = signal<{ clave: string; nombre: string }[]>([]);
  protected readonly empleado = signal<EmpleadoResumen | null>(null);
  protected readonly filtro = signal('');
  protected readonly filtroOrigen = signal('');
  protected readonly guardando = signal(false);
  protected readonly resultado = signal<{ importadas: number; errores: { renglon: number; texto: string; error: string }[] } | null>(null);

  protected nueva = { conceptoId: null as number | null, importe: null as number | null, referencia: '' };
  protected origenArchivo = 'inasistencias';
  protected archivo: File | null = null;

  protected readonly capturables = computed(() => this.contexto.conceptos().filter((c) => !c.calculado));
  protected readonly visibles = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    return this.capturas().filter(
      (c) =>
        (!this.filtroOrigen() || c.origen === this.filtroOrigen()) &&
        (!q || c.nombre.toLowerCase().includes(q) || c.curp.toLowerCase().includes(q) || String(c.clave) === q),
    );
  });
  protected readonly totales = computed(() => {
    const v = this.visibles();
    const suma = (n: 'P' | 'D') => v.filter((c) => c.naturaleza === n).reduce((s, c) => s + c.importe, 0);
    return { p: suma('P'), d: suma('D'), personas: new Set(v.map((c) => c.empleadoId)).size };
  });
  /** Lo capturado a la persona elegida, para ver de un vistazo qué ya tiene. */
  protected readonly delEmpleado = computed(() => this.capturas().filter((c) => c.empleadoId === this.empleado()?.id));
  protected readonly nombreOrigen = computed(() => new Map(this.origenes().map((o) => [o.clave, o.nombre.split(' (')[0]])));

  constructor() {
    this.api.origenes().subscribe((o) => this.origenes.set(o));
    effect(() => {
      const p = this.contexto.periodo();
      this.empleado.set(null);
      if (p) this.cargar(p.id);
      else this.capturas.set([]);
    });
  }

  private cargar(periodoId: number): void {
    this.api.capturas(periodoId).subscribe((c) => this.capturas.set(c));
  }

  protected elegir(e: EmpleadoResumen): void {
    this.empleado.set(e);
    this.nueva = { conceptoId: this.nueva.conceptoId, importe: null, referencia: '' };
    setTimeout(() => document.getElementById('concepto')?.focus());
  }

  protected agregar(): void {
    const p = this.contexto.periodo();
    const e = this.empleado();
    if (!p || !e || !this.nueva.conceptoId || !this.nueva.importe || this.guardando()) return;
    this.guardando.set(true);
    this.api
      .capturar(p.id, { empleadoId: e.id, conceptoId: this.nueva.conceptoId, importe: this.nueva.importe, referencia: this.nueva.referencia || undefined })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.nueva = { conceptoId: this.nueva.conceptoId, importe: null, referencia: '' };
          this.cargar(p.id);
          this.campoImporte()?.nativeElement.focus();
        },
        error: (err) => {
          this.guardando.set(false);
          this.avisos.error(mensajeDeError(err));
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

  protected elegirArchivo(evento: Event): void {
    this.archivo = (evento.target as HTMLInputElement).files?.[0] ?? null;
    this.resultado.set(null);
  }

  protected importar(): void {
    const p = this.contexto.periodo();
    if (!p || !this.archivo) return;
    this.guardando.set(true);
    this.api.importarCapturas(p.id, this.archivo, this.origenArchivo).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.resultado.set(r);
        if (r.importadas) this.avisos.exito(`${r.importadas} movimientos importados.`);
        this.cargar(p.id);
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }
}
