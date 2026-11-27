import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { AjustesExterno, MovimientoExterno, ReciboExterno } from '../../core/services/modelos';
import { BuscarClave } from '../../shared/buscar-clave/buscar-clave';
import { FORMATO } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';

type ClaveAjuste = NonNullable<AjustesExterno['claves']>[number];

/**
 * Antes de aplicar un movimiento de Personal: cuánto le saldría en la quincena abierta y lo que nómina
 * completa (cuenta bancaria, claves de más). Se guarda aparte; lo que mandó Personal no cambia.
 */
@Component({
  selector: 'app-completar-movimiento',
  imports: [FormsModule, BuscarClave, Icono, ...FORMATO],
  template: `
    <section class="bloque" aria-live="polite">
      <h3 class="titulo-chico">Cuánto le saldría{{ recibo()?.quincena ? ' en la ' + recibo()!.quincena : '' }}</h3>
      @if (cargando() && !recibo()) {
        <div class="esqueleto"></div>
      } @else if (recibo(); as r) {
        @if (r.problema) {
          <p class="tenue chico">Se calcula cuando se pueda aplicar.</p>
        } @else {
          <p class="tenue chico">Importes <strong>por quincena</strong> (la mitad del mes) · nivel {{ r.nivel }}, rango {{ r.rango }} · {{ r.dias }} días. Con el mismo cálculo de la nómina; todavía no se guarda nada.</p>
          <table class="recibo" [class.tenue-carga]="cargando()">
            <tbody>
              @for (l of percepciones(); track l.clave) {
                <tr><td class="mono tenue">{{ clave3(l.clave) }}</td><td>{{ l.descripcion }}</td><td class="cifra">{{ l.importe | moneda }}</td></tr>
              }
              <tr class="total"><td></td><td>Percepciones</td><td class="cifra">{{ r.totalPercepciones | moneda }}</td></tr>
              @for (l of deducciones(); track l.clave) {
                <tr><td class="mono tenue">{{ clave3(l.clave) }}</td><td>{{ l.descripcion }}</td><td class="cifra negativo">−{{ l.importe | moneda }}</td></tr>
              }
              <tr class="total"><td></td><td>Deducciones</td><td class="cifra">−{{ r.totalDeducciones | moneda }}</td></tr>
              <tr class="neto"><td></td><td>Neto a pagar</td><td class="cifra">{{ r.neto | moneda }}</td></tr>
            </tbody>
          </table>
          @if (r.percepcionesPersonalMes) {
            <p class="nota chico" [class.ambar]="!cuadra()">
              @if (cuadra()) {
                En Personal se capturaron {{ r.percepcionesPersonalMes | moneda }} al mes: son {{ r.percepcionesPersonalMes / 2 | moneda }} por quincena, igual que aquí.
              } @else {
                En Personal se capturaron {{ r.percepcionesPersonalMes | moneda }} al mes ({{ r.percepcionesPersonalMes / 2 | moneda }} por quincena) y aquí salen {{ r.totalPercepciones | moneda }}. Revisa la diferencia antes de aplicar.
              }
            </p>
          }
        }
      }
    </section>

    @if (puede()) {
      @if (esAlta()) {
        <section class="bloque">
          <h3 class="titulo-chico">Forma de pago</h3>
          <label class="casilla"><input type="checkbox" [ngModel]="cheque()" (ngModelChange)="cheque.set($event); sucio.set(true)" />Pagarle con cheque</label>
          @if (!cheque()) {
            <div class="linea">
              <div><label class="etiqueta" for="aj-banco">Banco</label><input id="aj-banco" class="campo" maxlength="20" [ngModel]="banco()" (ngModelChange)="banco.set($event); sucio.set(true)" /></div>
              <div class="crece">
                <label class="etiqueta" for="aj-cuenta">Cuenta o CLABE</label>
                <input id="aj-cuenta" class="campo mono" inputmode="numeric" maxlength="18" placeholder="10, 11, 16 o 18 dígitos" [ngModel]="cuenta()" (ngModelChange)="cuenta.set($event); sucio.set(true)" [class.invalido]="cuenta() && !cuentaValida()" />
              </div>
            </div>
            @if (cuenta() && !cuentaValida()) {<p class="ayuda negativo">Debe tener 10, 11, 16 o 18 dígitos.</p>}
            @else if (movimiento().cuentaPersonal && !cuentaEditada()) {<p class="ayuda">La trajo Personal.</p>}
          }
        </section>
      }

      <section class="bloque">
        <h3 class="titulo-chico">Percepciones y deducciones de más</h3>
        @for (k of claves(); track $index) {
          <div class="clave-extra">
            <span class="num mono" [class.d]="naturaleza(k.clave) === 'D'">{{ clave3(k.clave) }}</span>
            <span class="texto"><strong>{{ nombre(k.clave) }}</strong><small>{{ k.importe | moneda }} · {{ k.cada === 'esta' ? 'solo esta quincena' : 'cada quincena' }}</small></span>
            <button type="button" class="boton-icono" (click)="quitar($index)" [attr.aria-label]="'Quitar ' + nombre(k.clave)"><app-icono nombre="basura" [tamano]="15" /></button>
          </div>
        } @empty {
          <p class="tenue chico">Ninguna. Las del tabulador ya van solas.</p>
        }
        <div class="agregar">
          <app-buscar-clave idCampo="aj-clave" marcador="Clave: número o nombre" [conceptos]="capturables()" [valor]="nuevaId()" (valorChange)="nuevaId.set($event)" />
          <div class="linea">
            <div><label class="etiqueta" for="aj-importe">Importe por quincena</label><input id="aj-importe" class="campo cifra" type="number" min="0.01" step="0.01" [(ngModel)]="nuevoImporte" /></div>
            <div class="crece">
              <label class="etiqueta" for="aj-cada">Cuándo</label>
              <select id="aj-cada" class="campo" [(ngModel)]="nuevaCada">
                <option value="quincena">Cada quincena (fija en su ficha)</option>
                <option value="esta">Solo esta quincena</option>
              </select>
            </div>
          </div>
          <button type="button" class="boton chico" [disabled]="!nuevaId() || !nuevoImporte || nuevoImporte <= 0" (click)="agregar()"><app-icono nombre="mas" [tamano]="14" />Agregar</button>
        </div>
      </section>

      <div class="guardar">
        @if (sucio()) {<span class="tenue chico">Sin guardar</span>}
        <button type="button" class="boton primario chico" [disabled]="!sucio() || guardando() || (!cheque() && !!cuenta() && !cuentaValida())" (click)="guardar()">{{ guardando() ? 'Guardando…' : 'Guardar y recalcular' }}</button>
      </div>
    }
  `,
  styles: `
    .bloque { display: grid; gap: 10px; margin-bottom: 22px; }
    .bloque > p { margin: 0; }
    .recibo { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    .recibo td { padding: 5px 4px; border-bottom: 1px solid var(--linea); }
    .recibo td:first-child { width: 44px; }
    .recibo .cifra { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .recibo .total td { color: var(--apagado); font-weight: 600; }
    .recibo .neto td { border-bottom: 0; padding-top: 10px; font-size: 1rem; font-weight: 700; }
    .recibo .neto .cifra { color: var(--acento); }
    .linea { display: flex; flex-wrap: wrap; gap: 10px; }
    .linea > div { min-width: 120px; flex: 1 1 120px; }
    .crece { flex: 2 1 180px !important; }
    .invalido { border-color: var(--rojo); }
    .clave-extra { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--linea); border-radius: 10px; }
    .num { flex: none; min-width: 44px; padding: 3px 8px; border-radius: 8px; background: var(--acento-suave); color: var(--acento); font-size: 0.8125rem; text-align: center; }
    .num.d { background: var(--rojo-suave); color: var(--rojo); }
    .texto { flex: 1; min-width: 0; }
    .texto strong, .texto small { display: block; }
    .texto strong { font-size: 0.875rem; font-weight: 600; }
    .texto small { color: var(--apagado); font-size: 0.8125rem; }
    .agregar { display: grid; gap: 10px; padding: 12px; border: 1px dashed var(--linea-fuerte); border-radius: 10px; }
    .agregar .boton { justify-self: start; }
    .guardar { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-bottom: 8px; }
  `,
})
export class CompletarMovimiento {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly contexto = inject(ContextoService);

  readonly movimiento = input.required<MovimientoExterno>();
  readonly sistema = input.required<string>();
  readonly puede = input(false);
  /** Se guardaron los ajustes: la lista debe volver a pedir el resumen. */
  readonly cambiado = output<void>();

  protected readonly recibo = signal<ReciboExterno | null>(null);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  /** Hay cambios sin guardar; quien aplica los guarda antes. */
  readonly sucio = signal(false);
  protected readonly cheque = signal(false);
  protected readonly banco = signal('CITIBANAMEX');
  protected readonly cuenta = signal('');
  protected readonly claves = signal<ClaveAjuste[]>([]);
  protected readonly nuevaId = signal<number | null>(null);
  protected nuevoImporte: number | null = null;
  protected nuevaCada: ClaveAjuste['cada'] = 'quincena';

  protected readonly esAlta = computed(() => this.movimiento().tipo === 'A' && this.movimiento().subtipo === 'NUE' && !this.movimiento().empleadoId);
  private readonly catalogo = computed(() => {
    const nomina = this.movimiento().tipoNomina ?? this.contexto.tipoNomina();
    return (this.contexto.opciones()?.conceptos ?? []).filter((c) => c.tipoNomina === nomina);
  });
  protected readonly capturables = computed(() => this.catalogo().filter((c) => !c.calculado));
  protected readonly cuentaValida = computed(() => /^(\d{10}|\d{11}|\d{16}|\d{18})$/.test(this.cuenta().replace(/\D/g, '')));
  protected readonly cuentaEditada = computed(() => (this.movimiento().ajustes?.cuentaBancaria ?? undefined) !== undefined);
  /** Lo de Personal (por mes) entre dos es lo de la quincena completa; con menos días no se compara. */
  protected readonly cuadra = computed(() => {
    const r = this.recibo();
    if (!r?.percepcionesPersonalMes || r.dias !== 15) return true;
    const extra = (this.claves() ?? []).filter((k) => this.naturaleza(k.clave) === 'P').reduce((s, k) => s + k.importe, 0);
    return Math.abs(r.percepcionesPersonalMes / 2 + extra - (r.totalPercepciones ?? 0)) < 0.05;
  });
  protected readonly percepciones = computed(() => (this.recibo()?.lineas ?? []).filter((l) => l.naturaleza === 'P'));
  protected readonly deducciones = computed(() => (this.recibo()?.lineas ?? []).filter((l) => l.naturaleza === 'D'));

  constructor() {
    // Cada vez que se abre otro movimiento: sus ajustes guardados y su recibo.
    effect(() => {
      const m = this.movimiento();
      untracked(() => {
        const a = m.ajustes ?? {};
        this.cheque.set(!!a.pagoCheque);
        this.banco.set(a.banco || 'CITIBANAMEX');
        this.cuenta.set(a.cuentaBancaria ?? String(m.cuentaPersonal ?? '').replace(/\D/g, ''));
        this.claves.set([...(a.claves ?? [])]);
        this.sucio.set(false);
        this.nuevaId.set(null);
        this.nuevoImporte = null;
        this.recibo.set(null);
        this.cargar();
      });
    });
  }

  protected clave3(c: number): string {
    return String(c).padStart(3, '0');
  }

  protected nombre(clave: number): string {
    return this.catalogo().find((c) => c.clave === clave)?.nombre ?? `Clave ${this.clave3(clave)}`;
  }

  protected naturaleza(clave: number): 'P' | 'D' {
    return this.catalogo().find((c) => c.clave === clave)?.naturaleza ?? 'P';
  }

  protected agregar(): void {
    const c = this.capturables().find((x) => x.id === this.nuevaId());
    if (!c || !this.nuevoImporte || this.nuevoImporte <= 0) return;
    const importe = Math.round(Number(this.nuevoImporte) * 100) / 100;
    this.claves.update((l) => [...l.filter((k) => !(k.clave === c.clave && k.cada === this.nuevaCada)), { clave: c.clave, importe, cada: this.nuevaCada }]);
    this.nuevaId.set(null);
    this.nuevoImporte = null;
    this.sucio.set(true);
  }

  protected quitar(i: number): void {
    this.claves.update((l) => l.filter((_, j) => j !== i));
    this.sucio.set(true);
  }

  /** Para Aplicar: guarda lo pendiente y dice si se pudo. */
  guardarPendiente(): Promise<boolean> {
    if (!this.sucio()) return Promise.resolve(true);
    if (!this.cheque() && !!this.cuenta() && !this.cuentaValida()) {
      this.avisos.error('Corrige la cuenta bancaria antes de aplicar.');
      return Promise.resolve(false);
    }
    return new Promise((listo) => this.guardar(listo));
  }

  protected guardar(listo?: (ok: boolean) => void): void {
    const cuenta = this.cuenta().replace(/\D/g, '');
    const ajustes: AjustesExterno = {
      claves: this.claves(),
      ...(this.esAlta() ? { pagoCheque: this.cheque(), banco: this.banco().trim() || null, cuentaBancaria: this.cheque() || !cuenta ? null : cuenta } : {}),
    };
    this.guardando.set(true);
    this.api.ajustarExterno(this.sistema(), this.movimiento().id, ajustes).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.sucio.set(false);
        this.recibo.set(r);
        if (!listo) this.avisos.exito('Guardado. Así se aplicará.');
        this.cambiado.emit();
        listo?.(true);
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(mensajeDeError(e));
        listo?.(false);
      },
    });
  }

  private cargar(): void {
    this.cargando.set(true);
    this.api.reciboExterno(this.sistema(), this.movimiento().id).subscribe({
      next: (r) => {
        this.cargando.set(false);
        this.recibo.set(r);
      },
      error: (e) => {
        this.cargando.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }
}
