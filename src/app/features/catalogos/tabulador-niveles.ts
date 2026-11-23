import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FORMATO } from '../../shared/formato';

type Fila = Record<string, unknown>;

interface Importes {
  sueldo: number;
  gratificacion: number;
  compensacion: number;
  total: number;
}

interface Rango extends Importes {
  rango: number;
  vigencia: string;
  fila: Fila;
  /** Cambio del total contra la tabla anterior, en por ciento; null si no había. */
  cambio: number | null;
}

interface Nivel {
  nivel: number;
  rangos: Rango[];
}

/** La tabla del nivel 0: la pone el sistema en ceros para quien no está en la tabla-rang. */
const SIN_NIVEL = 0;

/**
 * El tabulador agrupado: un renglón por nivel y, al abrirlo, sus rangos. Muestra una vigencia a la vez,
 * con la misma regla del cálculo: de cada nivel y rango, el renglón más reciente a esa fecha.
 */
@Component({
  selector: 'app-tabulador-niveles',
  imports: [FormsModule, ...FORMATO],
  template: `
    <div class="barra-filtros">
      <label class="control">
        <span class="etiqueta">Tabulador</span>
        <select id="tabulador-vigencia" class="campo" [ngModel]="vigencia()" (ngModelChange)="elegida.set($event)">
          @for (v of vigencias(); track v) {<option [value]="v">Desde {{ v | fecha }}{{ v === enUso() ? ' · en uso hoy' : v > hoy ? ' · futuro' : '' }}</option>}
        </select>
      </label>
      <label class="control">
        <span class="etiqueta">Nivel</span>
        <input id="tabulador-nivel" class="campo corto" type="number" min="1" placeholder="Todos" [ngModel]="buscado()" (ngModelChange)="buscado.set($event)" />
      </label>
      <div class="control">
        <span class="etiqueta" id="tabulador-importes">Importes</span>
        <div class="selector" role="group" aria-labelledby="tabulador-importes">
          <button type="button" [class.activo]="!mensual()" [attr.aria-pressed]="!mensual()" (click)="mensual.set(false)">Por quincena</button>
          <button type="button" [class.activo]="mensual()" [attr.aria-pressed]="mensual()" (click)="mensual.set(true)">Por mes</button>
        </div>
      </div>
      <button type="button" class="boton fin" [disabled]="!niveles().length" (click)="alternarTodos()">{{ todosAbiertos() ? 'Cerrar todos' : 'Abrir todos' }}</button>
    </div>

    <p class="tenue chico" style="margin-bottom: 10px">
      {{ niveles().length }} niveles. El <strong>sueldo</strong> depende del nivel; la <strong>gratificación</strong> y la <strong>compensación</strong>, del nivel y el rango. Abre un nivel para ver sus rangos.
      @if (anterior(); as a) {El cambio es contra la tabla del {{ a | fecha }}.}
    </p>

    <div class="tabla-marco">
      <table class="tabla">
        <thead>
          <tr>
            <th class="nivel">Nivel</th>
            <th class="der">Sueldo <span class="clave">001</span></th>
            <th class="der">Gratificación <span class="clave">012</span></th>
            <th class="der">Compensación <span class="clave">011</span></th>
            <th class="der">Total {{ mensual() ? 'al mes' : 'por quincena' }}</th>
            @if (anterior()) {<th class="der">Cambio</th>}
          </tr>
        </thead>
        @for (n of niveles(); track n.nivel) {
          @let abierto = abiertos().has(n.nivel);
          <tbody [class.abierto]="abierto">
            <tr class="clic cabeza" (click)="alternar(n.nivel)">
              <td class="nivel">
                <button type="button" class="abrir" [attr.aria-expanded]="abierto" [attr.aria-label]="(abierto ? 'Cerrar' : 'Abrir') + ' nivel ' + n.nivel" (click)="alternar(n.nivel); $event.stopPropagation()">
                  <span class="flecha" aria-hidden="true">›</span>Nivel {{ n.nivel }}
                </button>
              </td>
              <td class="der cifra">{{ tramo(n, 'sueldo') }}</td>
              <td class="der cifra" [class.tenue]="!maximo(n, 'gratificacion')">{{ tramo(n, 'gratificacion') }}</td>
              <td class="der cifra" [class.tenue]="!maximo(n, 'compensacion')">{{ tramo(n, 'compensacion') }}</td>
              <td class="der cifra"><strong>{{ tramo(n, 'total') }}</strong></td>
              @if (anterior()) {<td class="der mono chico">{{ cambioNivel(n) }}</td>}
            </tr>
            @if (abierto) {
              @for (r of n.rangos; track r.rango) {
                <tr class="clic rango" tabindex="0" title="Editar este rango" (click)="editar.emit(r.fila)" (keydown.enter)="editar.emit(r.fila)">
                  <td class="nivel">
                    Rango {{ r.rango }}
                    @if (r.vigencia !== vigencia()) {<span class="sub">tabla del {{ r.vigencia | fecha }}</span>}
                  </td>
                  <td class="der cifra">{{ r.sueldo | moneda }}</td>
                  <td class="der cifra" [class.tenue]="!r.gratificacion">{{ r.gratificacion ? (r.gratificacion | moneda) : '—' }}</td>
                  <td class="der cifra" [class.tenue]="!r.compensacion">{{ r.compensacion ? (r.compensacion | moneda) : '—' }}</td>
                  <td class="der cifra"><strong>{{ r.total | moneda }}</strong></td>
                  @if (anterior()) {<td class="der mono chico">{{ porciento(r.cambio) }}</td>}
                </tr>
              }
            }
          </tbody>
        } @empty {
          <tbody><tr><td [attr.colspan]="anterior() ? 6 : 5"><div class="vacio"><p class="titulo-chico">{{ buscado() ? 'No hay nivel ' + buscado() : 'Sin tabulador' }}</p></div></td></tr></tbody>
        }
      </table>
    </div>
    @if (haySinNivel()) {
      <p class="tenue chico" style="margin-top: 10px">No se muestra el nivel 0: está en ceros y es para quien no está en la tabla-rang; su sueldo se captura.</p>
    }
  `,
  styles: `
    .barra-filtros { align-items: flex-end; }
    .control { display: grid; gap: 4px; }
    .corto { width: 110px; }
    .fin { margin-left: auto; }
    .selector { display: inline-flex; overflow: hidden; border: 1px solid var(--linea-fuerte); border-radius: var(--radio); }
    .selector button { padding: 8px 14px; border: 0; background: var(--superficie); color: var(--tinta); font: inherit; font-size: 0.875rem; cursor: pointer; }
    .selector button.activo { background: var(--acento-suave); color: var(--acento); font-weight: 600; }
    .selector button:focus-visible { outline: 2px solid var(--acento); outline-offset: -2px; }
    .clave { margin-left: 4px; font-family: var(--mono); font-weight: 400; opacity: 0.75; }
    .nivel { white-space: nowrap; }
    /* Los renglones van en un tbody por nivel: la línea de abajo se conserva entre niveles. */
    .tabla tbody tr:last-child td { border-bottom: 1px solid var(--linea); }
    .tabla tbody:last-child tr:last-child td { border-bottom: 0; }
    .abrir { display: inline-flex; align-items: center; gap: 10px; padding: 0; border: 0; background: none; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
    .abrir:focus-visible { outline: 2px solid var(--acento); outline-offset: 4px; }
    .flecha { display: inline-block; width: 12px; color: var(--apagado); font-size: 1.125rem; line-height: 1; transition: transform 0.12s; }
    .abierto .flecha { color: var(--acento); transform: rotate(90deg); }
    .abierto .cabeza td { background: var(--acento-suave); }
    .rango .nivel { padding-left: 34px; color: var(--apagado); }
    .rango:focus-visible { outline: 2px solid var(--acento); outline-offset: -2px; }
    @media (prefers-reduced-motion: reduce) { .flecha { transition: none; } }
  `,
})
export class TabuladorNiveles {
  readonly filas = input.required<Fila[]>();
  readonly editar = output<Fila>();

  protected readonly elegida = signal<string | null>(null);
  protected readonly buscado = signal<number | null>(null);
  protected readonly mensual = signal(false);
  protected readonly abiertos = signal<Set<number>>(new Set());
  protected readonly hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  private readonly moneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

  /** Fechas de las tablas cargadas, de la más reciente a la más antigua. */
  protected readonly vigencias = computed(() =>
    [...new Set(this.filas().filter((f) => Number(f['nivel']) !== SIN_NIVEL).map((f) => String(f['vigencia'])))].sort().reverse(),
  );
  protected readonly enUso = computed(() => this.vigencias().find((v) => v <= this.hoy) ?? null);
  protected readonly vigencia = computed(() => {
    const e = this.elegida();
    return e && this.vigencias().includes(e) ? e : (this.enUso() ?? this.vigencias()[0] ?? '');
  });
  /** La tabla inmediata anterior a la que se ve, para mostrar cuánto cambió. */
  protected readonly anterior = computed(() => this.vigencias().find((v) => v < this.vigencia()) ?? null);
  protected readonly haySinNivel = computed(() => this.filas().some((f) => Number(f['nivel']) === SIN_NIVEL));

  protected readonly niveles = computed<Nivel[]>(() => {
    const ant = this.anterior();
    const antes = ant ? this.vigentes(ant) : null;
    const niveles = new Map<number, Rango[]>();
    for (const [llave, fila] of this.vigentes(this.vigencia())) {
      const nivel = Number(fila['nivel']);
      const previa = antes?.get(llave);
      const importes = this.importes(fila);
      const totalAntes = previa ? this.importes(previa).total : 0;
      const rango: Rango = {
        ...importes,
        rango: Number(fila['rango']),
        vigencia: String(fila['vigencia']),
        fila,
        cambio: totalAntes ? (importes.total / totalAntes - 1) * 100 : null,
      };
      niveles.set(nivel, [...(niveles.get(nivel) ?? []), rango]);
    }
    const buscado = this.buscado();
    return [...niveles]
      .filter(([n]) => !buscado || n === buscado)
      .sort(([a], [b]) => a - b)
      .map(([nivel, rangos]) => ({ nivel, rangos: rangos.sort((a, b) => a.rango - b.rango) }));
  });
  protected readonly todosAbiertos = computed(() => this.niveles().length > 0 && this.niveles().every((n) => this.abiertos().has(n.nivel)));

  constructor() {
    // Si se busca un nivel, se abre solo.
    effect(() => {
      const n = this.buscado();
      if (n) untracked(() => this.abiertos.update((s) => new Set(s).add(n)));
    });
  }

  protected alternar(nivel: number): void {
    this.abiertos.update((s) => {
      const nuevo = new Set(s);
      if (!nuevo.delete(nivel)) nuevo.add(nivel);
      return nuevo;
    });
  }

  protected alternarTodos(): void {
    this.abiertos.set(this.todosAbiertos() ? new Set() : new Set(this.niveles().map((n) => n.nivel)));
  }

  /** "$6,214.00" si todos los rangos dan lo mismo, "$1,311.60 a $2,144.35", o "hasta $3,934.35" si alguno no lleva. */
  protected tramo(n: Nivel, campo: keyof Importes): string {
    const valores = n.rangos.map((r) => r[campo]);
    const [min, max] = [Math.min(...valores), Math.max(...valores)];
    if (max === 0) return '—';
    if (min === 0) return `hasta ${this.moneda.format(max)}`;
    return min === max ? this.moneda.format(max) : `${this.moneda.format(min)} a ${this.moneda.format(max)}`;
  }

  protected maximo(n: Nivel, campo: keyof Importes): number {
    return Math.max(...n.rangos.map((r) => r[campo]));
  }

  protected cambioNivel(n: Nivel): string {
    const c = n.rangos.map((r) => r.cambio).filter((x): x is number => x !== null);
    if (!c.length) return 'nuevo';
    const [min, max] = [this.porciento(Math.min(...c)), this.porciento(Math.max(...c))];
    return min === max ? min : `${min} a ${max}`;
  }

  protected porciento(v: number | null): string {
    if (v === null) return 'nuevo';
    const texto = v.toFixed(2);
    return Number(texto) === 0 ? 'igual' : `${v > 0 ? '+' : ''}${texto} %`;
  }

  /** De cada nivel y rango, el renglón más reciente a esa fecha. */
  private vigentes(fecha: string): Map<string, Fila> {
    const mapa = new Map<string, Fila>();
    for (const f of [...this.filas()].sort((a, b) => String(a['vigencia']).localeCompare(String(b['vigencia'])))) {
      if (String(f['vigencia']) <= fecha && Number(f['nivel']) !== SIN_NIVEL) mapa.set(`${f['nivel']}-${f['rango']}`, f);
    }
    return mapa;
  }

  /** En la base van mensuales; la quincena es la mitad, redondeada por clave como en el cálculo. */
  private importes(f: Fila): Importes {
    const de = (campo: string) => {
      const centavos = Math.round(Number(f[campo] ?? 0) * 100);
      return (this.mensual() ? centavos : Math.round(centavos / 2)) / 100;
    };
    const [sueldo, gratificacion, compensacion] = [de('sueldoMensual'), de('gratificacionMensual'), de('compensacionMensual')];
    return { sueldo, gratificacion, compensacion, total: Math.round((sueldo + gratificacion + compensacion) * 100) / 100 };
  }
}
