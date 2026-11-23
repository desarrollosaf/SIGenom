import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { VistaRetroactivo } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';

/** Retroactivo de un aumento: la diferencia de las quincenas ya pagadas, como captura de la quincena abierta. */
@Component({
  selector: 'app-retroactivo',
  imports: [FormsModule, ...FORMATO],
  template: `
    <section class="tarjeta con-relleno seccion" style="margin-top: 20px">
      <h2 class="titulo-chico">Retroactivo del aumento</h2>
      <p class="apagado chico">
        Compara lo que se pagó en cada quincena desde esa fecha contra el tabulador de la quincena abierta
        ({{ contexto.periodo()?.nombre ?? 'ninguna' }}) y captura la diferencia en 101, 111 y 112. Las quincenas pagadas no se tocan.
      </p>
      <div class="barra-filtros" style="margin-top: 12px; align-items: flex-end">
        <div><label class="etiqueta" for="retro-desde">El aumento vale desde</label><input id="retro-desde" class="campo" type="date" [(ngModel)]="desde" (ngModelChange)="vista.set(null)" /></div>
        <button type="button" class="boton" [disabled]="!desde || !contexto.abierto() || ocupado()" (click)="calcular()">Ver cuánto sale</button>
        @if (vista()?.empleados && puede()) {<button type="button" class="boton primario" [disabled]="ocupado()" (click)="aplicar()">Capturar retroactivo</button>}
      </div>

      @if (vista(); as v) {
        @if (!v.empleados) {
          <p class="nota" style="margin-top: 12px">No hay diferencia que pagar. Revisa que el tabulador nuevo esté cargado y vigente en la quincena abierta.</p>
        } @else {
          <div class="cifras" style="margin-top: 14px">
            <div class="cifra-bloque"><span class="antetitulo">Total</span><span class="valor">{{ v.total | moneda }}</span></div>
            <div class="cifra-bloque"><span class="antetitulo">Personas</span><span class="valor">{{ v.empleados | numero }}</span></div>
            <div class="cifra-bloque"><span class="antetitulo">Quincenas</span><span class="valor">{{ v.quincenas }}</span></div>
          </div>
          <table class="tabla" style="margin-top: 12px">
            <thead><tr><th>Clave</th><th>Descripción</th><th class="der">Personas</th><th class="der">Importe</th></tr></thead>
            <tbody>@for (c of v.claves; track c.clave) {<tr><td class="mono">{{ c.clave }}</td><td>{{ c.descripcion }}</td><td class="der">{{ c.empleados | numero }}</td><td class="der cifra">{{ c.total | moneda }}</td></tr>}</tbody>
          </table>
          <details style="margin-top: 12px">
            <summary class="chico">Los 20 importes más altos</summary>
            <table class="tabla"><tbody>@for (m of v.muestra; track m.empleadoId) {<tr><td>{{ m.nombre }}</td><td class="tenue">{{ m.quincenas }} quincenas</td><td class="der cifra">{{ m.total | moneda }}</td></tr>}</tbody></table>
          </details>
        }
        @if (v.yaRetro) {<p class="nota ambar" style="margin-top: 10px">{{ v.yaRetro | numero }} personas ya tienen capturado su retroactivo por otro lado y se dejan como están, para no pagarles dos veces.</p>}
        @if (v.sinNivel) {<p class="nota ambar" style="margin-top: 10px">{{ v.sinNivel | numero }} personas no tienen nivel en el tabulador; su retroactivo se captura a mano.</p>}
      }
    </section>
  `,
})
export class Retroactivo {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);
  protected readonly puede = computed(() => !!this.auth.currentUser()?.capacidades.capturar && this.contexto.abierto());
  protected readonly vista = signal<VistaRetroactivo | null>(null);
  protected readonly ocupado = signal(false);
  protected desde = '';

  protected calcular(): void {
    const p = this.contexto.periodo();
    if (!p) return;
    this.ocupado.set(true);
    this.api.vistaRetroactivo(p.id, this.desde).subscribe({
      next: (v) => {
        this.ocupado.set(false);
        this.vista.set(v);
      },
      error: (e) => this.fallo(e),
    });
  }

  protected async aplicar(): Promise<void> {
    const p = this.contexto.periodo();
    const v = this.vista();
    if (!p || !v) return;
    const ok = await this.avisos.confirmar({
      titulo: 'Capturar retroactivo',
      texto: `${v.total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} a ${v.empleados} personas en la ${p.nombre}. Sustituye el retroactivo calculado antes en esta quincena.`,
      accion: 'Capturar',
    });
    if (!ok) return;
    this.ocupado.set(true);
    this.api.aplicarRetroactivo(p.id, this.desde).subscribe({
      next: (r) => {
        this.ocupado.set(false);
        this.vista.set(r);
        this.avisos.exito('Retroactivo capturado. Calcula la prenómina para verlo en los recibos.');
      },
      error: (e) => this.fallo(e),
    });
  }

  private fallo(e: unknown): void {
    this.ocupado.set(false);
    this.avisos.error(mensajeDeError(e));
  }
}
