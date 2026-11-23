import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import type { AjusteNeto, ReciboPrueba } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';

type Modo = 'P' | 'D';

/**
 * Corrige a una persona con neto negativo sin salir de Verificación: sube una percepción (gratificación
 * extra por omisión) o baja una deducción. El importe lo calcula el motor de la nómina, porque subir
 * una percepción que grava también sube el ISR y las cuotas.
 */
@Component({
  selector: 'app-ajuste-neto',
  imports: [FormsModule, RouterLink, ...FORMATO],
  template: `
    @if (datos(); as d) {
      <p><a [routerLink]="['/empleados', d.empleadoId]">Ver su ficha</a></p>
      <div class="cifras" style="margin: 12px 0">
        <div class="cifra-bloque"><span class="antetitulo">Percepciones</span><span class="valor">{{ d.recibo.totalPercepciones | moneda }}</span></div>
        <div class="cifra-bloque"><span class="antetitulo">Deducciones</span><span class="valor">{{ d.recibo.totalDeducciones | moneda }}</span></div>
        <div class="cifra-bloque"><span class="antetitulo">Neto hoy</span><span class="valor" [class.negativo]="d.recibo.neto <= 0">{{ d.recibo.neto | moneda }}</span></div>
      </div>

      @if (d.ajustes.length) {
        <h3 class="titulo-chico">Ajustes hechos en esta quincena</h3>
        <table class="tabla" style="margin: 8px 0 16px">
          <tbody>
            @for (a of d.ajustes; track a.id) {
              <tr>
                <td class="min mono">{{ clave(a.clave) }}</td>
                <td>{{ a.descripcion }}<br /><span class="tenue chico">{{ a.referencia }} · {{ a.registradoPor }}</span></td>
                <td class="der cifra">{{ a.importe | moneda }}</td>
                <td class="min">@if (puede()) {<button type="button" class="boton chico" [disabled]="ocupado()" (click)="quitar(a.id)">Quitar</button>}</td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (puede()) {
        <h3 class="titulo-chico">{{ d.recibo.neto > 0 ? 'Agregar otro ajuste' : 'Corregir' }}</h3>
        <div class="formulario uno" style="margin-top: 8px">
          <div class="fila-opciones" role="radiogroup" aria-label="Cómo corregir">
            <label class="casilla"><input type="radio" name="modo-ajuste" [checked]="modo() === 'P'" (change)="cambiarModo('P')" />Subir una percepción</label>
            <label class="casilla"><input type="radio" name="modo-ajuste" [checked]="modo() === 'D'" [disabled]="!d.deducciones.length" (change)="cambiarModo('D')" />Bajar una deducción</label>
          </div>
          <div>
            <label class="etiqueta" for="ajuste-clave">{{ modo() === 'P' ? 'Percepción' : 'Deducción' }}</label>
            <select id="ajuste-clave" class="campo" [ngModel]="conceptoId()" (ngModelChange)="elegir($event)">
              @for (o of opciones(); track o.conceptoId) {
                <option [ngValue]="o.conceptoId">{{ clave(o.clave) }} · {{ o.descripcion }}{{ o.importe ? ' (hoy ' + (o.importe | moneda) + ')' : '' }}</option>
              }
            </select>
            @if (modo() === 'D') {<p class="ayuda">Lo que bajes deja de descontarse esta quincena. Si se debe, hay que cobrarlo después.</p>}
          </div>
          <div class="dos-campos">
            <div>
              <label class="etiqueta" for="ajuste-objetivo">Neto que debe quedar</label>
              <input id="ajuste-objetivo" class="campo cifra" type="number" min="0.01" step="0.01" [(ngModel)]="objetivo" (keydown.enter)="sugerir()" />
            </div>
            <div style="align-self: end"><button type="button" class="boton" [disabled]="ocupado() || !(objetivo > 0)" (click)="sugerir()">Calcular importe</button></div>
          </div>
          <div>
            <label class="etiqueta" for="ajuste-importe">{{ modo() === 'P' ? 'Importe a subir' : 'Importe a bajar' }}</label>
            <input id="ajuste-importe" class="campo cifra" type="number" min="0.01" step="0.01" [ngModel]="importe()" (ngModelChange)="escribir($event)" />
          </div>
          <div>
            <label class="etiqueta" for="ajuste-motivo">Motivo (opcional)</label>
            <input id="ajuste-motivo" class="campo" maxlength="80" placeholder="Ajuste de neto" [(ngModel)]="motivo" />
          </div>
        </div>

        @if (prueba(); as p) {
          <table class="tabla" style="margin-top: 16px">
            <thead><tr><th>Cómo queda</th><th class="der">Hoy</th><th class="der">Con el ajuste</th></tr></thead>
            <tbody>
              @for (c of cambios(); track c.clave) {
                <tr><td><span class="mono tenue">{{ clave(c.clave) }}</span> {{ c.descripcion }}</td><td class="der cifra">{{ c.antes | moneda }}</td><td class="der cifra">{{ c.despues | moneda }}</td></tr>
              }
              <tr><td><strong>Neto</strong></td><td class="der cifra">{{ d.recibo.neto | moneda }}</td><td class="der cifra"><strong [class.negativo]="p.neto <= 0">{{ p.neto | moneda }}</strong></td></tr>
            </tbody>
          </table>
          <button type="button" class="boton primario" style="margin-top: 12px" [disabled]="ocupado() || !importe() || p.neto <= 0" (click)="aplicar()">Guardar ajuste</button>
        }
      }
    } @else if (error()) {
      <p class="nota negativo">{{ error() }}</p>
    } @else {
      <div class="esqueleto" style="height: 120px"></div>
    }
  `,
  styles: `
    .fila-opciones { display: flex; flex-wrap: wrap; gap: 16px; }
    .dos-campos { display: grid; grid-template-columns: 1fr auto; gap: 12px; }
  `,
})
export class AjusteNetoPanel {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);

  readonly periodoId = input.required<number>();
  readonly empleadoId = input.required<number>();
  readonly puede = input(false);
  /** Se guardó o se quitó un ajuste: el cálculo ya no refleja lo capturado. */
  readonly cambio = output<void>();

  protected readonly datos = signal<AjusteNeto | null>(null);
  protected readonly error = signal('');
  protected readonly modo = signal<Modo>('P');
  protected readonly conceptoId = signal<number | null>(null);
  protected readonly importe = signal<number | null>(null);
  protected readonly prueba = signal<ReciboPrueba | null>(null);
  protected readonly ocupado = signal(false);
  protected objetivo = 0.01;
  protected motivo = '';
  private espera: ReturnType<typeof setTimeout> | null = null;
  /** Para descartar respuestas de pruebas que ya no corresponden a lo que se ve. */
  private turno = 0;

  protected readonly opciones = computed(() => (this.modo() === 'P' ? this.datos()?.percepciones : this.datos()?.deducciones) ?? []);
  protected readonly cambios = computed(() => {
    const antes = new Map((this.datos()?.recibo.lineas ?? []).map((l) => [l.clave, l]));
    const despues = new Map((this.prueba()?.lineas ?? []).map((l) => [l.clave, l]));
    return [...new Set([...antes.keys(), ...despues.keys()])]
      .map((c) => ({ clave: c, descripcion: (antes.get(c) ?? despues.get(c))!.descripcion, antes: antes.get(c)?.importe ?? 0, despues: despues.get(c)?.importe ?? 0 }))
      .filter((c) => c.antes !== c.despues)
      .sort((a, b) => a.clave - b.clave);
  });

  constructor() {
    effect(() => {
      const [p, e] = [this.periodoId(), this.empleadoId()];
      this.datos.set(null);
      this.error.set('');
      this.api.ajusteNeto(p, e).subscribe({
        next: (d) => {
          this.recibir(d);
          if (d.recibo.neto <= 0 && this.puede()) this.sugerir();
        },
        error: (x) => this.error.set(mensajeDeError(x)),
      });
    });
  }

  protected clave(c: number): string {
    return String(c).padStart(3, '0');
  }

  protected cambiarModo(m: Modo): void {
    this.modo.set(m);
    this.elegir(this.opciones()[0]?.conceptoId ?? null);
  }

  protected elegir(id: number | null): void {
    this.conceptoId.set(id);
    this.limpiar();
    if (id && (this.datos()?.recibo.neto ?? 1) <= 0) this.sugerir();
  }

  /** El menor importe que deja el neto pedido. */
  protected sugerir(): void {
    this.probar({ objetivo: this.objetivo });
  }

  protected escribir(valor: number | null): void {
    this.importe.set(valor);
    this.prueba.set(null);
    if (this.espera) clearTimeout(this.espera);
    if (valor && valor > 0) this.espera = setTimeout(() => this.probar({ importe: valor }), 350);
  }

  protected aplicar(): void {
    const [conceptoId, importe] = [this.conceptoId(), this.importe()];
    if (!conceptoId || !importe || this.ocupado()) return;
    this.ocupado.set(true);
    this.api.aplicarAjusteNeto(this.periodoId(), { empleadoId: this.empleadoId(), conceptoId, importe, motivo: this.motivo.trim() || undefined }).subscribe({
      next: (d) => {
        this.ocupado.set(false);
        this.recibir(d);
        this.avisos.exito('Ajuste guardado. Vuelve a calcular la prenómina para que se refleje.');
        this.cambio.emit();
      },
      error: (e) => this.fallo(e),
    });
  }

  protected quitar(id: number): void {
    this.ocupado.set(true);
    this.api.borrarCaptura(id).subscribe({
      next: () =>
        this.api.ajusteNeto(this.periodoId(), this.empleadoId()).subscribe({
          next: (d) => {
            this.ocupado.set(false);
            this.recibir(d);
            this.cambio.emit();
          },
          error: (e) => this.fallo(e),
        }),
      error: (e) => this.fallo(e),
    });
  }

  private probar(con: { importe?: number; objetivo?: number }): void {
    const conceptoId = this.conceptoId();
    if (!conceptoId) return;
    const turno = ++this.turno;
    this.ocupado.set(true);
    this.api.probarAjusteNeto(this.periodoId(), { empleadoId: this.empleadoId(), conceptoId, ...con }).subscribe({
      next: (r) => {
        if (turno !== this.turno) return;
        this.ocupado.set(false);
        this.importe.set(r.importe);
        this.prueba.set(r.recibo);
      },
      error: (e) => {
        if (turno === this.turno) this.fallo(e);
      },
    });
  }

  private recibir(d: AjusteNeto): void {
    this.datos.set(d);
    this.modo.set('P');
    this.conceptoId.set(d.percepciones[0]?.conceptoId ?? null);
    this.limpiar();
  }

  private limpiar(): void {
    this.turno++;
    this.importe.set(null);
    this.prueba.set(null);
    this.ocupado.set(false);
  }

  private fallo(e: unknown): void {
    this.ocupado.set(false);
    this.prueba.set(null);
    this.avisos.error(mensajeDeError(e));
  }
}
