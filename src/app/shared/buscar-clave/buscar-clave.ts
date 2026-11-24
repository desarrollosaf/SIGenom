import { Component, computed, effect, ElementRef, input, model, signal, untracked, viewChild } from '@angular/core';
import type { ConceptoOpcion } from '../../core/services/modelos';

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Elige una clave escribiendo su número o su nombre. Percepciones y deducciones van separadas. */
@Component({
  selector: 'app-buscar-clave',
  template: `
    <div class="caja" (focusout)="salir($event)">
      <input
        #entrada
        class="campo"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        [id]="idCampo()"
        [placeholder]="marcador()"
        [disabled]="deshabilitado()"
        [value]="abierto() ? texto() : etiqueta()"
        [attr.aria-label]="marcador()"
        [attr.aria-expanded]="abierto()"
        [attr.aria-controls]="idCampo() + '-lista'"
        [attr.aria-activedescendant]="abierto() && opciones().length ? idCampo() + '-' + indice() : null"
        (focus)="abrir()"
        (click)="abrir()"
        (input)="escribir($any($event.target).value)"
        (keydown)="tecla($event)"
      />
      @if (valor() !== null && !deshabilitado()) {
        <button type="button" class="quitar" aria-label="Quitar clave" (mousedown)="$event.preventDefault()" (click)="limpiar()">×</button>
      }
      @if (abierto()) {
        <ul #lista class="lista" role="listbox" [id]="idCampo() + '-lista'">
          @for (c of opciones(); track c.id; let i = $index) {
            @if (i === 0 || opciones()[i - 1].naturaleza !== c.naturaleza) {
              <li class="grupo" role="presentation">{{ c.naturaleza === 'P' ? 'Percepciones' : 'Deducciones' }}</li>
            }
            <li
              class="opcion"
              role="option"
              [id]="idCampo() + '-' + i"
              [class.activo]="i === indice()"
              [attr.aria-selected]="c.id === valor()"
              (mouseenter)="indice.set(i)"
              (mousedown)="$event.preventDefault(); elegir(c)"
            >
              <span class="num" [class.d]="c.naturaleza === 'D'">{{ numero(c) }}</span>
              <span class="nombre">{{ c.nombre }}</span>
            </li>
          } @empty {
            <li class="vacia">No hay clave con “{{ texto() }}”</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .caja { position: relative; }
    .caja .campo { width: 100%; padding-right: 30px; text-overflow: ellipsis; }
    .quitar { position: absolute; top: 50%; right: 5px; width: 24px; height: 24px; border: 0; border-radius: 6px; background: none; color: var(--tenue); font-size: 1.0625rem; line-height: 1; cursor: pointer; transform: translateY(-50%); }
    .quitar:hover { background: var(--fondo-2); color: var(--tinta); }
    .lista { position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; width: max(100%, min(380px, 86vw)); max-height: 320px; margin: 0; padding: 4px; border: 1px solid var(--linea); border-radius: var(--radio); background: var(--superficie); box-shadow: var(--sombra); list-style: none; overflow-y: auto; }
    .grupo { padding: 8px 10px 4px; color: var(--tenue); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
    .opcion { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 6px; font-size: 0.875rem; cursor: pointer; }
    .opcion.activo { background: var(--fondo-2); }
    .opcion[aria-selected='true'] .nombre { font-weight: 600; }
    .num { flex: none; min-width: 40px; padding: 1px 6px; border-radius: 6px; background: var(--acento-suave); color: var(--acento); font-family: var(--mono); font-size: 0.75rem; text-align: center; }
    .num.d { background: var(--rojo-suave); color: var(--rojo); }
    .nombre { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vacia { padding: 12px 10px; color: var(--apagado); font-size: 0.875rem; }
  `,
})
export class BuscarClave {
  readonly conceptos = input.required<ConceptoOpcion[]>();
  readonly marcador = input('Busca por clave o nombre');
  readonly deshabilitado = input(false);
  readonly idCampo = input('clave');
  readonly valor = model<number | null>(null);

  protected readonly texto = signal('');
  protected readonly abierto = signal(false);
  protected readonly indice = signal(0);
  private readonly entrada = viewChild<ElementRef<HTMLInputElement>>('entrada');
  private readonly lista = viewChild<ElementRef<HTMLElement>>('lista');

  private readonly elegida = computed(() => this.conceptos().find((c) => c.id === this.valor()) ?? null);
  protected readonly etiqueta = computed(() => {
    const c = this.elegida();
    return c ? `${this.numero(c)} · ${c.nombre}` : '';
  });
  /** Empieza por el número, luego por el nombre; sin texto, todas. Cada palabra debe aparecer. */
  protected readonly opciones = computed(() => {
    const q = sinAcentos(this.texto().trim());
    const orden = (l: ConceptoOpcion[]) => [...l].sort((a, b) => b.naturaleza.localeCompare(a.naturaleza) || a.clave - b.clave);
    if (!q) return orden(this.conceptos());
    if (/^\d+$/.test(q)) {
      const exactas = this.conceptos().filter((c) => c.clave === Number(q));
      const empiezan = this.conceptos().filter((c) => c.clave !== Number(q) && (this.numero(c).startsWith(q) || String(c.clave).startsWith(q)));
      return exactas.length === 1 ? [...exactas, ...orden(empiezan)] : orden([...exactas, ...empiezan]);
    }
    const palabras = q.split(/\s+/);
    return orden(this.conceptos().filter((c) => palabras.every((p) => sinAcentos(c.nombre).includes(p))));
  });

  constructor() {
    effect(() => {
      this.opciones();
      untracked(() => this.indice.set(0));
    });
    // La opción marcada con el teclado siempre a la vista.
    effect(() => {
      const i = this.indice();
      if (this.abierto()) this.lista()?.nativeElement.querySelector(`#${CSS.escape(this.idCampo() + '-' + i)}`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  protected numero(c: ConceptoOpcion): string {
    return String(c.clave).padStart(3, '0');
  }

  protected abrir(): void {
    if (this.abierto() || this.deshabilitado()) return;
    this.texto.set('');
    this.abierto.set(true);
    setTimeout(() => this.entrada()?.nativeElement.select());
  }

  protected escribir(valor: string): void {
    this.abierto.set(true);
    this.texto.set(valor);
  }

  protected elegir(c: ConceptoOpcion): void {
    this.valor.set(c.id);
    this.cerrar();
  }

  protected limpiar(): void {
    this.valor.set(null);
    this.texto.set('');
    this.entrada()?.nativeElement.focus();
  }

  protected tecla(e: KeyboardEvent): void {
    const ultimo = this.opciones().length - 1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.abierto()) return this.abrir();
      this.indice.update((i) => Math.max(0, Math.min(ultimo, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && this.abierto()) {
      e.preventDefault();
      const c = this.opciones()[this.indice()];
      if (c) this.elegir(c);
    } else if (e.key === 'Escape') {
      this.cerrar();
    }
  }

  protected salir(e: FocusEvent): void {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) this.cerrar();
  }

  private cerrar(): void {
    this.abierto.set(false);
    this.texto.set('');
  }
}
