import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { AjusteQuincena } from '../../core/services/modelos';

/**
 * Claves que solo en esta quincena gravan o se timbran distinto de lo que dice el catálogo: p. ej.
 * una percepción que esta quincena no se timbra ni grava, o que se timbra pero no grava.
 * Se aplica en el siguiente cálculo; el catálogo no cambia.
 */
@Component({
  selector: 'app-ajustes-quincena',
  imports: [FormsModule],
  template: `
    <section class="tarjeta con-relleno seccion">
      <div class="cabeza-seccion">
        <div>
          <h2 class="titulo-chico">Ajustes de claves para esta quincena</h2>
          <p class="apagado chico">Quita o pon la palomita solo para esta quincena; el catálogo no cambia. Vale desde el siguiente cálculo.</p>
        </div>
      </div>

      @if (ajustes().length) {
        <div class="tabla-marco" style="margin-top: 12px">
          <table class="tabla">
            <thead>
              <tr><th>Clave</th><th>Descripción</th><th class="centro">Grava ISR</th><th class="centro">Se timbra</th><th>Motivo</th><th></th></tr>
            </thead>
            <tbody>
              @for (a of ajustes(); track a.conceptoId) {
                <tr>
                  <td class="mono">{{ a.naturaleza }} {{ clave(a.clave) }}</td>
                  <td>{{ a.descripcion }}</td>
                  <td class="centro">
                    @if (a.naturaleza === 'P') {
                      <label class="casilla" [class.ambar]="a.gravaIsr !== null" [title]="'Catálogo: ' + (a.catalogo.gravaIsr ? 'sí' : 'no')">
                        <input type="checkbox" [checked]="a.gravaIsr ?? a.catalogo.gravaIsr" [disabled]="!puede()" (change)="cambiar(a, 'gravaIsr', $any($event.target).checked)" />
                      </label>
                    } @else {<span class="tenue">—</span>}
                  </td>
                  <td class="centro">
                    <label class="casilla" [class.ambar]="a.timbra !== null" [title]="'Catálogo: ' + (a.catalogo.timbra ? 'sí' : 'no')">
                      <input type="checkbox" [checked]="a.timbra ?? a.catalogo.timbra" [disabled]="!puede()" (change)="cambiar(a, 'timbra', $any($event.target).checked)" />
                    </label>
                  </td>
                  <td class="chico">{{ a.motivo ?? '' }} <span class="tenue">· {{ a.registradoPor }}</span></td>
                  <td class="der">
                    @if (puede()) {<button type="button" class="boton chico" (click)="quitar(a)">Como el catálogo</button>}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="tenue chico" style="margin-top: 8px">Esta quincena todas las claves se calculan como dice el catálogo.</p>
      }

      @if (puede()) {
        <div class="barra-filtros" style="margin-top: 14px; align-items: flex-end">
          <select class="campo" aria-label="Clave" [ngModel]="nuevaId()" (ngModelChange)="elegir($event)">
            <option [ngValue]="null">Agregar una clave…</option>
            @for (c of disponibles(); track c.id) {
              <option [ngValue]="c.id">{{ c.naturaleza }} {{ clave(c.clave) }} · {{ c.nombre }}</option>
            }
          </select>
          @if (nueva(); as n) {
            @if (n.naturaleza === 'P') {
              <label class="casilla"><input type="checkbox" [(ngModel)]="nuevaGrava" />Grava ISR</label>
            }
            <label class="casilla"><input type="checkbox" [(ngModel)]="nuevaTimbra" />Se timbra</label>
            <input class="campo crece" placeholder="Motivo (opcional)" maxlength="200" [(ngModel)]="motivo" />
            <button type="button" class="boton primario chico" [disabled]="!cambia()" (click)="agregar()">Guardar</button>
          }
        </div>
        @if (nueva() && !cambia()) {<p class="ayuda">Quita o pon alguna palomita: así como está es igual al catálogo.</p>}
      }
    </section>
  `,
})
export class AjustesQuincena {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly contexto = inject(ContextoService);

  readonly periodoId = input.required<number>();
  readonly puede = input(false);

  protected readonly ajustes = signal<AjusteQuincena[]>([]);
  protected readonly nuevaId = signal<number | null>(null);
  protected nuevaGrava = false;
  protected nuevaTimbra = true;
  protected motivo = '';

  protected readonly nueva = computed(() => this.contexto.conceptos().find((c) => c.id === this.nuevaId()) ?? null);
  protected readonly disponibles = computed(() => {
    const usados = new Set(this.ajustes().map((a) => a.conceptoId));
    return this.contexto.conceptos().filter((c) => !usados.has(c.id));
  });

  constructor() {
    effect(() => {
      const id = this.periodoId();
      this.api.ajustesQuincena(id).subscribe({ next: (l) => this.ajustes.set(l), error: () => this.ajustes.set([]) });
    });
  }

  protected clave(c: number): string {
    return String(c).padStart(3, '0');
  }

  protected elegir(id: number | null): void {
    this.nuevaId.set(id);
    const c = this.contexto.conceptos().find((x) => x.id === id);
    this.nuevaGrava = c?.gravaIsr ?? false;
    this.nuevaTimbra = c?.timbra ?? true;
    this.motivo = '';
  }

  protected cambia(): boolean {
    const c = this.nueva();
    return !!c && ((c.naturaleza === 'P' && this.nuevaGrava !== c.gravaIsr) || this.nuevaTimbra !== c.timbra);
  }

  protected agregar(): void {
    const c = this.nueva();
    if (!c) return;
    this.guardar({
      conceptoId: c.id,
      gravaIsr: c.naturaleza === 'P' ? this.nuevaGrava : null,
      timbra: this.nuevaTimbra,
      motivo: this.motivo.trim() || undefined,
    });
    this.nuevaId.set(null);
  }

  protected cambiar(a: AjusteQuincena, campo: 'gravaIsr' | 'timbra', valor: boolean): void {
    const actual = { gravaIsr: a.gravaIsr ?? a.catalogo.gravaIsr, timbra: a.timbra ?? a.catalogo.timbra, [campo]: valor };
    this.guardar({
      conceptoId: a.conceptoId,
      gravaIsr: a.naturaleza === 'P' ? actual.gravaIsr : null,
      timbra: actual.timbra,
      motivo: a.motivo ?? undefined,
    });
  }

  protected quitar(a: AjusteQuincena): void {
    this.guardar({ conceptoId: a.conceptoId, gravaIsr: null, timbra: null });
  }

  private guardar(datos: { conceptoId: number; gravaIsr: boolean | null; timbra: boolean | null; motivo?: string }): void {
    this.api.ajustarQuincena(this.periodoId(), datos).subscribe({
      next: (l) => {
        this.ajustes.set(l);
        this.avisos.exito('Ajuste guardado. Vuelve a calcular la quincena para aplicarlo.');
      },
      error: (e) => {
        this.avisos.error(mensajeDeError(e));
        this.api.ajustesQuincena(this.periodoId()).subscribe((l) => this.ajustes.set(l));
      },
    });
  }
}
