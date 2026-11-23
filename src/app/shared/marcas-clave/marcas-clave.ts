import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { ApiService } from '../../core/services/api.service';
import type { AjusteQuincena, ConceptoOpcion, ImpactoMovimiento } from '../../core/services/modelos';
import { FORMATO } from '../formato';

/**
 * Palomitas "Grava ISR" y "Se timbra" de un movimiento, con lo que dice la quincena o el catálogo por
 * omisión, y cómo cambiarían el ISR, las cuotas y el neto de la persona antes de guardarlo.
 * Las marcas salen en null cuando quedan igual que el valor por omisión.
 */
@Component({
  selector: 'app-marcas-clave',
  imports: [...FORMATO],
  template: `
    <div class="marcas">
      @if (concepto().naturaleza === 'P') {
        <label class="casilla" title="Si grava, entra a la base y el ISR se vuelve a calcular">
          <input type="checkbox" [checked]="gravaEfectivo()" (change)="cambiarGrava($any($event.target).checked)" />Grava ISR
        </label>
      }
      <label class="casilla" title="Si se timbra, va en el CFDI de nómina. No cambia el ISR">
        <input type="checkbox" [checked]="timbraEfectivo()" (change)="cambiarTimbra($any($event.target).checked)" />Se timbra
      </label>
      @if (concepto().naturaleza === 'P') {
        <span class="tenue chico">{{ concepto().cotizaIssemym ? 'Cotiza ISSEMyM' : 'No cotiza ISSEMyM' }}</span>
      }
      @if (gravaIsr() !== null || timbra() !== null) {<span class="insignia sin-punto ambar">Distinto {{ ajuste() ? 'de la quincena' : 'del catálogo' }}</span>}
      @else if (ajuste()) {<span class="insignia sin-punto azul">Como el ajuste de la quincena</span>}
    </div>
    @if (impacto(); as i) {
      <div class="impacto chico" aria-live="polite">
        <span>Base ISR {{ i.antes.baseIsr | moneda }} → <strong>{{ i.despues.baseIsr | moneda }}</strong></span>
        <span>ISR {{ i.antes.isr | moneda }} → <strong>{{ i.despues.isr | moneda }}</strong></span>
        <span>ISSEMyM y SCI {{ i.antes.issemym | moneda }} → <strong>{{ i.despues.issemym | moneda }}</strong></span>
        <span>Neto {{ i.antes.neto | moneda }} → <strong [class.negativo]="i.despues.neto <= 0">{{ i.despues.neto | moneda }}</strong></span>
      </div>
    }
  `,
  styles: `
    .marcas { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
    .impacto { display: flex; flex-wrap: wrap; gap: 4px 18px; margin-top: 8px; padding: 8px 12px; border: 1px solid var(--linea); border-radius: var(--radio); }
  `,
})
export class MarcasClave {
  private readonly api = inject(ApiService);

  readonly concepto = input.required<ConceptoOpcion>();
  readonly periodoId = input<number | null>(null);
  readonly empleadoId = input<number | null>(null);
  readonly importe = input<number | null>(null);
  readonly fija = input(false);
  readonly gravaIsr = model<boolean | null>(null);
  readonly timbra = model<boolean | null>(null);

  private readonly ajustes = signal<AjusteQuincena[]>([]);
  protected readonly impacto = signal<ImpactoMovimiento | null>(null);
  protected readonly ajuste = computed(() => this.ajustes().find((a) => a.conceptoId === this.concepto().id) ?? null);
  private readonly gravaOmision = computed(() => this.ajuste()?.gravaIsr ?? this.concepto().gravaIsr);
  private readonly timbraOmision = computed(() => this.ajuste()?.timbra ?? this.concepto().timbra);
  protected readonly gravaEfectivo = computed(() => this.gravaIsr() ?? this.gravaOmision());
  protected readonly timbraEfectivo = computed(() => this.timbra() ?? this.timbraOmision());

  constructor() {
    // Otra clave: se empieza con lo que dice su catálogo.
    let anterior: number | undefined;
    effect(() => {
      const id = this.concepto().id;
      untracked(() => {
        if (anterior !== undefined && anterior !== id) {
          this.gravaIsr.set(null);
          this.timbra.set(null);
        }
        anterior = id;
      });
    });
    effect((limpiar) => {
      const p = this.periodoId();
      this.ajustes.set([]);
      if (!p) return;
      const s = this.api.ajustesQuincena(p).subscribe({ next: (l) => this.ajustes.set(l), error: () => undefined });
      limpiar(() => s.unsubscribe());
    });
    effect((limpiar) => {
      const [p, empleadoId, importe] = [this.periodoId(), this.empleadoId(), this.importe()];
      const datos = { conceptoId: this.concepto().id, gravaIsr: this.gravaIsr(), timbra: this.timbra(), fija: this.fija() };
      this.impacto.set(null);
      if (!p || !empleadoId || !importe) return;
      const espera = setTimeout(() => {
        const s = this.api.probarCaptura(p, { empleadoId, importe, ...datos }).subscribe({ next: (i) => this.impacto.set(i), error: () => undefined });
        this.cancelar = () => s.unsubscribe();
      }, 350);
      limpiar(() => {
        clearTimeout(espera);
        this.cancelar();
      });
    });
  }

  private cancelar: () => void = () => undefined;

  protected cambiarGrava(v: boolean): void {
    this.gravaIsr.set(v === this.gravaOmision() ? null : v);
  }

  protected cambiarTimbra(v: boolean): void {
    this.timbra.set(v === this.timbraOmision() ? null : v);
  }
}
