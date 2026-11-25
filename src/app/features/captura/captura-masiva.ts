import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { DatosMasiva, MasivaHecha, VistaMasiva } from '../../core/services/modelos';
import { BuscarClave } from '../../shared/buscar-clave/buscar-clave';
import { FORMATO } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';
import { MarcasClave } from '../../shared/marcas-clave/marcas-clave';

type Quienes = 'todos' | 'adscripcion' | 'nivel';

/**
 * La misma clave a muchas personas: se elige a quiénes, se ve cuántas son y cuánto cuesta (con ISR y
 * cuotas), y se captura. Queda como un solo grupo que se puede deshacer.
 */
@Component({
  selector: 'app-captura-masiva',
  imports: [FormsModule, BuscarClave, MarcasClave, Icono, ...FORMATO],
  template: `
    <div class="pasos">
      <div class="linea">
        <div class="crece">
          <label class="etiqueta" for="masiva-clave">Clave</label>
          <app-buscar-clave idCampo="masiva-clave" [conceptos]="capturables()" [valor]="conceptoId()" (valorChange)="conceptoId.set($event); cambio()" />
        </div>
        <div>
          <label class="etiqueta" for="masiva-importe">Importe a cada quien</label>
          <input id="masiva-importe" class="campo cifra" type="number" min="0.01" step="0.01" placeholder="1500.00" [ngModel]="importe()" (ngModelChange)="importe.set($event); cambio()" />
        </div>
        <div class="crece">
          <label class="etiqueta" for="masiva-ref">Referencia</label>
          <input id="masiva-ref" class="campo" maxlength="80" placeholder="Bono de navidad" [ngModel]="referencia()" (ngModelChange)="referencia.set($event)" />
        </div>
      </div>

      @if (clave(); as c) {
        <app-marcas-clave [concepto]="c" [periodoId]="periodoId()" [gravaIsr]="gravaIsr()" (gravaIsrChange)="gravaIsr.set($event); cambio()" [timbra]="timbra()" (timbraChange)="timbra.set($event); cambio()" />
      }

      <div>
        <span class="etiqueta" id="masiva-quienes">A quiénes</span>
        <div class="pildoras" role="group" aria-labelledby="masiva-quienes">
          @for (q of opciones; track q.valor) {
            <button type="button" [class.activa]="quienes() === q.valor" [attr.aria-pressed]="quienes() === q.valor" (click)="quienes.set(q.valor); cambio()">{{ q.etiqueta }}</button>
          }
        </div>
      </div>

      @if (quienes() === 'adscripcion') {
        <div>
          <select id="masiva-adscripcion" class="campo" aria-label="Agregar adscripción" [ngModel]="null" (ngModelChange)="agregarAdscripcion($event)">
            <option [ngValue]="null">Agregar una adscripción…</option>
            @for (a of libres(); track a.id) {<option [ngValue]="a.id">{{ a.id }} · {{ a.nombre }}</option>}
          </select>
          <div class="fichas">
            @for (a of adscripciones(); track a) {<button type="button" class="ficha" (click)="quitarAdscripcion(a)" [attr.aria-label]="'Quitar adscripción ' + a">{{ a }} <span aria-hidden="true">×</span></button>}
          </div>
        </div>
      }
      @if (quienes() === 'nivel') {
        <div class="linea">
          <div><label class="etiqueta" for="masiva-desde">Del nivel</label><input id="masiva-desde" class="campo cifra" type="number" min="1" [ngModel]="nivelDesde()" (ngModelChange)="nivelDesde.set($event); cambio()" /></div>
          <div><label class="etiqueta" for="masiva-hasta">Al nivel</label><input id="masiva-hasta" class="campo cifra" type="number" min="1" [ngModel]="nivelHasta()" (ngModelChange)="nivelHasta.set($event); cambio()" /></div>
        </div>
      }

      <div class="reglas">
        <label class="casilla"><input type="checkbox" [ngModel]="omitir()" (ngModelChange)="omitir.set($event); cambio()" />No repetir a quien ya tenga esa clave en la quincena</label>
        <label class="casilla"><input type="checkbox" [ngModel]="soloConPago()" (ngModelChange)="soloConPago.set($event); cambio()" />Solo a quien cobra esta quincena</label>
      </div>

      <div><button type="button" class="boton" [disabled]="!listo() || ocupado()" (click)="revisar()">{{ ocupado() && !vista() ? 'Calculando…' : 'Ver cuánto sale' }}</button></div>
    </div>

    @if (vista(); as v) {
      <div class="vista" aria-live="polite">
        @if (v.personas) {
          <div class="cifras">
            <div class="cifra-bloque"><span class="antetitulo">Personas</span><span class="valor">{{ v.personas | numero }}</span></div>
            <div class="cifra-bloque"><span class="antetitulo">{{ v.naturaleza === 'P' ? 'Se paga' : 'Se descuenta' }}</span><span class="valor">{{ v.total | moneda }}</span></div>
            @if (v.naturaleza === 'P') {
              <div class="cifra-bloque"><span class="antetitulo">ISR de más</span><span class="valor">{{ v.isr | moneda }}</span></div>
              <div class="cifra-bloque"><span class="antetitulo">ISSEMyM y SCI de más</span><span class="valor">{{ v.issemym | moneda }}</span></div>
            }
            <div class="cifra-bloque"><span class="antetitulo">{{ v.naturaleza === 'P' ? 'Les llega' : 'Cambia el neto' }}</span><span class="valor" style="color: var(--acento)">{{ v.neto | moneda }}</span><p class="nota">{{ v.netoMenor === v.netoMayor ? (v.netoMenor | moneda) + ' a cada quien' : 'de ' + (v.netoMenor | moneda) + ' a ' + (v.netoMayor | moneda) + ' por persona' }}</p></div>
          </div>
        } @else {<p class="nota ambar">No hay a quién capturarle con esas reglas.</p>}
        @if (v.naturaleza === 'P' && v.personas && v.cotiza) {<p class="nota">Esta clave cotiza al ISSEMyM: por eso también suben esas cuotas.</p>}
        @if (v.conClave) {<p class="nota" [class.ambar]="!omitir()">{{ v.conClave | numero }} {{ v.conClave === 1 ? 'persona ya tiene' : 'personas ya tienen' }} esa clave en la quincena{{ omitir() ? '; no se les repite.' : ' y se les sumaría otra vez.' }}</p>}
        @if (v.sinPago && soloConPago()) {<p class="nota">{{ v.sinPago | numero }} no {{ v.sinPago === 1 ? 'cobra' : 'cobran' }} esta quincena y no entran.</p>}
        @if (v.quedanNegativos) {<p class="nota rojo">{{ v.quedanNegativos | numero }} {{ v.quedanNegativos === 1 ? 'persona quedaría' : 'personas quedarían' }} con neto en cero o negativo.</p>}
        @if (v.personas) {<button type="button" class="boton primario" [disabled]="ocupado()" (click)="aplicar()">{{ ocupado() ? 'Capturando…' : 'Capturar a ' + (v.personas | numero) + (v.personas === 1 ? ' persona' : ' personas') }}</button>}
      </div>
    }

    @if (hechas().length) {
      <div class="hechas">
        <p class="antetitulo">Capturado a varias en esta quincena</p>
        @for (h of hechas(); track h.id) {
          <div class="hecha" [class.deshecha]="h.deshechoEl">
            <span class="num mono" [class.d]="h.naturaleza === 'D'">{{ h.clave.toString().padStart(3, '0') }}</span>
            <span class="texto">
              <strong>{{ h.referencia || h.descripcion }}</strong>
              <small>{{ h.importe | moneda }} a {{ h.personas | numero }} {{ h.personas === 1 ? 'persona' : 'personas' }} · {{ h.naturaleza === 'P' ? (h.gravaIsr ? 'grava' : 'no grava') + ', ' : '' }}{{ h.timbra ? 'se timbra' : 'no se timbra' }} · {{ h.registradoPor }}, {{ h.creadaEl | fecha: true }}</small>
              @if (h.deshechoEl) {<small>Deshecha por {{ h.deshechoPor }}, {{ h.deshechoEl | fecha: true }}</small>}
            </span>
            @if (!h.deshechoEl) {<button type="button" class="boton chico" [disabled]="ocupado()" (click)="deshacer(h)"><app-icono nombre="basura" [tamano]="14" />Deshacer</button>}
          </div>
        }
      </div>
    }
  `,
  styles: `
    .pasos { display: grid; gap: 18px; }
    .linea { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
    .linea > div { min-width: 120px; }
    .crece { flex: 1 1 200px; }
    .pildoras { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .pildoras button { padding: 7px 14px; border: 1px solid var(--linea-fuerte); border-radius: 999px; background: var(--superficie); color: var(--apagado); font: inherit; font-size: 0.8125rem; cursor: pointer; }
    .pildoras button:focus-visible, .ficha:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
    .pildoras .activa { border-color: var(--acento); background: var(--acento-suave); color: var(--acento); font-weight: 600; }
    .fichas { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .ficha { padding: 3px 10px; border: 0; border-radius: 999px; background: var(--acento-suave); color: var(--acento); font: inherit; font-size: 0.8125rem; cursor: pointer; }
    .reglas { display: flex; flex-wrap: wrap; gap: 8px 22px; }
    .vista { display: grid; justify-items: start; gap: 10px; margin-top: 18px; }
    .vista .cifras { width: 100%; }
    .hechas { display: grid; gap: 8px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--linea); }
    .hecha { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 1px solid var(--linea); border-radius: 12px; }
    .deshecha { opacity: 0.55; }
    .deshecha strong { text-decoration: line-through; }
    .num { flex: none; min-width: 44px; padding: 3px 8px; border-radius: 8px; background: var(--acento-suave); color: var(--acento); font-size: 0.8125rem; text-align: center; }
    .num.d { background: var(--rojo-suave); color: var(--rojo); }
    .texto { flex: 1; min-width: 0; }
    .texto strong, .texto small { display: block; }
    .texto strong { font-size: 0.875rem; font-weight: 600; }
    .texto small { color: var(--apagado); font-size: 0.8125rem; }
  `,
})
export class CapturaMasivaPanel {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly contexto = inject(ContextoService);

  readonly periodoId = input.required<number>();
  /** Se capturó o se deshizo: la lista de la quincena cambió. */
  readonly cambiada = output<void>();

  protected readonly opciones: { valor: Quienes; etiqueta: string }[] = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'adscripcion', etiqueta: 'Por adscripción' },
    { valor: 'nivel', etiqueta: 'Por nivel' },
  ];
  protected readonly conceptoId = signal<number | null>(null);
  protected readonly importe = signal<number | null>(null);
  protected readonly referencia = signal('');
  protected readonly gravaIsr = signal<boolean | null>(null);
  protected readonly timbra = signal<boolean | null>(null);
  protected readonly quienes = signal<Quienes>('todos');
  protected readonly adscripciones = signal<number[]>([]);
  protected readonly nivelDesde = signal<number | null>(null);
  protected readonly nivelHasta = signal<number | null>(null);
  protected readonly omitir = signal(true);
  protected readonly soloConPago = signal(true);
  protected readonly vista = signal<VistaMasiva | null>(null);
  protected readonly hechas = signal<MasivaHecha[]>([]);
  protected readonly ocupado = signal(false);
  /** Descarta la respuesta de una vista previa si ya se cambió algo. */
  private turno = 0;

  protected readonly capturables = computed(() => this.contexto.conceptos().filter((c) => !c.calculado));
  protected readonly clave = computed(() => this.capturables().find((c) => c.id === this.conceptoId()) ?? null);
  protected readonly libres = computed(() => (this.contexto.opciones()?.adscripciones ?? []).filter((a) => !this.adscripciones().includes(a.id)));
  protected readonly listo = computed(
    () =>
      !!this.clave() &&
      (this.importe() ?? 0) > 0 &&
      (this.quienes() !== 'adscripcion' || this.adscripciones().length > 0) &&
      (this.quienes() !== 'nivel' || !!this.nivelDesde() || !!this.nivelHasta()),
  );

  constructor() {
    effect(() => {
      const p = this.periodoId();
      this.vista.set(null);
      this.conceptoId.set(null);
      this.cargarHechas(p);
    });
  }

  /** Cambió algo del formulario: lo que se vio ya no vale. */
  protected cambio(): void {
    this.turno++;
    this.vista.set(null);
    this.ocupado.set(false);
  }

  protected agregarAdscripcion(id: number | null): void {
    if (!id) return;
    this.adscripciones.update((l) => [...l, id]);
    this.cambio();
  }

  protected quitarAdscripcion(id: number): void {
    this.adscripciones.update((l) => l.filter((x) => x !== id));
    this.cambio();
  }

  protected revisar(): void {
    if (!this.listo()) return;
    const turno = ++this.turno;
    this.ocupado.set(true);
    this.api.vistaMasiva(this.periodoId(), this.datos()).subscribe({
      next: (v) => {
        if (turno !== this.turno) return;
        this.ocupado.set(false);
        this.vista.set(v);
      },
      error: (e) => {
        if (turno === this.turno) this.fallo(e);
      },
    });
  }

  protected async aplicar(): Promise<void> {
    const v = this.vista();
    const c = this.clave();
    if (!v || !c || this.ocupado()) return;
    const datos = this.datos();
    const pesos = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
    const ok = await this.avisos.confirmar({
      titulo: `Capturar a ${v.personas} personas`,
      texto: `${pesos(datos.importe)} de ${c.nombre} a cada quien: ${pesos(v.total)} en total. Puedes deshacerlo mientras la quincena siga abierta.`,
      accion: 'Capturar',
    });
    if (!ok || this.vista() !== v) return;
    this.ocupado.set(true);
    this.api.aplicarMasiva(this.periodoId(), { ...datos, personas: v.personas }).subscribe({
      next: (r) => {
        this.ocupado.set(false);
        this.avisos.exito(`Capturado a ${r.personas} personas. Vuelve a calcular la quincena para verlo en los recibos.`);
        this.conceptoId.set(null);
        this.importe.set(null);
        this.referencia.set('');
        this.cambio();
        this.cargarHechas(this.periodoId());
        this.cambiada.emit();
      },
      error: (e) => {
        this.vista.set(null);
        this.fallo(e);
      },
    });
  }

  protected async deshacer(h: MasivaHecha): Promise<void> {
    const ok = await this.avisos.confirmar({ titulo: 'Deshacer la captura', texto: `Se quita ${h.referencia || h.descripcion} a las ${h.personas} personas. Queda en la bitácora.`, accion: 'Deshacer', peligro: true });
    if (!ok) return;
    this.ocupado.set(true);
    this.api.deshacerMasiva(this.periodoId(), h.id).subscribe({
      next: (r) => {
        this.ocupado.set(false);
        this.avisos.exito(`Se quitaron ${r.borradas} capturas.`);
        this.cambio();
        this.cargarHechas(this.periodoId());
        this.cambiada.emit();
      },
      error: (e) => this.fallo(e),
    });
  }

  private datos(): DatosMasiva {
    const q = this.quienes();
    return {
      conceptoId: this.conceptoId()!,
      importe: Number(this.importe()),
      gravaIsr: this.gravaIsr(),
      timbra: this.timbra(),
      referencia: this.referencia().trim() || undefined,
      filtro: {
        adscripciones: q === 'adscripcion' ? this.adscripciones() : undefined,
        nivelDesde: q === 'nivel' ? (this.nivelDesde() ?? undefined) : undefined,
        nivelHasta: q === 'nivel' ? (this.nivelHasta() ?? undefined) : undefined,
        omitirConClave: this.omitir(),
        soloConPago: this.soloConPago(),
      },
    };
  }

  private cargarHechas(periodoId: number): void {
    this.api.masivas(periodoId).subscribe({ next: (l) => this.hechas.set(l), error: () => this.hechas.set([]) });
  }

  private fallo(e: unknown): void {
    this.ocupado.set(false);
    this.avisos.error(mensajeDeError(e));
  }
}
