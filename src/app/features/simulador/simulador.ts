import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { ResultadoSimulacion } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';

/** Estimador de sueldo (1SLD-EST.W, AJUSTE.W): cuánto recibiría alguien, con el mismo motor de la nómina. */
@Component({
  selector: 'app-simulador',
  imports: [FormsModule, Icono, ...FORMATO],
  template: `
    <div class="pagina angosta">
      <header class="encabezado">
        <div>
          <p class="antetitulo">Consultas · {{ contexto.nombreNomina() }}</p>
          <h1 class="titulo">Estimador de sueldo</h1>
          <p class="apagado">Calcula una quincena con el tabulador y las tablas vigentes, sin guardar nada. Útil para ofertas y cambios de nivel.</p>
        </div>
      </header>

      <section class="tarjeta con-relleno">
        <div class="formulario">
          <div><label class="etiqueta">Nivel</label><input class="campo cifra" type="number" min="1" [(ngModel)]="nivel" /></div>
          <div><label class="etiqueta">Rango</label><input class="campo cifra" type="number" min="1" max="5" [(ngModel)]="rango" /></div>
          <div><label class="etiqueta">Días pagados</label><input class="campo cifra" type="number" min="0" max="15" step="0.5" [(ngModel)]="dias" /></div>
        </div>
        <p class="antetitulo" style="margin-top: 18px">Percepciones y deducciones fijas</p>
        @for (f of fijos(); track $index; let i = $index) {
          <div class="acciones fijo">
            <select class="campo" [(ngModel)]="f.conceptoId" aria-label="Concepto">
              @for (c of capturables(); track c.id) {<option [ngValue]="c.id">{{ c.clave }} · {{ c.nombre }}</option>}
            </select>
            <input class="campo cifra" type="number" step="0.01" style="width: 130px" [(ngModel)]="f.importe" aria-label="Importe" />
            <button type="button" class="boton-icono" (click)="quitar(i)" aria-label="Quitar"><app-icono nombre="basura" [tamano]="16" /></button>
          </div>
        }
        <div class="acciones" style="margin-top: 10px">
          <button type="button" class="boton chico" (click)="agregar()"><app-icono nombre="mas" [tamano]="15" />Agregar concepto</button>
          <span style="flex: 1"></span>
          <button type="button" class="boton primario" [disabled]="calculando()" (click)="calcular()">Calcular quincena</button>
        </div>
      </section>

      @if (resultado(); as r) {
        <section class="seccion">
          <div class="cifras">
            <div class="cifra-bloque"><span class="antetitulo">Percepciones</span><span class="valor">{{ r.totalPercepciones | moneda }}</span></div>
            <div class="cifra-bloque"><span class="antetitulo">Deducciones</span><span class="valor">{{ r.totalDeducciones | moneda }}</span></div>
            <div class="cifra-bloque"><span class="antetitulo">Neto quincenal</span><span class="valor" style="color: var(--acento)">{{ r.neto | moneda }}</span><p class="nota">≈ {{ r.neto * 2 | moneda }} al mes</p></div>
          </div>
          <div class="tabla-marco" style="margin-top: 12px">
            <table class="tabla">
              <tbody>
                @for (l of r.lineas; track l.conceptoId) {
                  <tr>
                    <td class="min mono tenue">{{ l.clave.toString().padStart(3, '0') }}</td>
                    <td>{{ l.descripcion }}</td>
                    <td class="der cifra" [class.negativo]="l.naturaleza === 'D'">{{ l.naturaleza === 'D' ? '−' : '' }}{{ l.importe | moneda }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="tenue chico" style="margin-top: 10px">Base ISR {{ r.baseIsr | moneda }} · ISR causado {{ r.isrCausado | moneda }} · subsidio {{ r.subsidio | moneda }} · base ISSEMYM {{ r.baseIssemym | moneda }}</p>
        </section>
      }
    </div>
  `,
  styles: `
    .fijo {
      margin-top: 8px;
      flex-wrap: nowrap;
    }
    .fijo select {
      flex: 1;
    }
  `,
})
export class Simulador {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly contexto = inject(ContextoService);

  protected nivel = 10;
  protected rango = 1;
  protected dias = 15;
  protected readonly fijos = signal<{ conceptoId: number | null; importe: number }[]>([]);
  protected readonly resultado = signal<ResultadoSimulacion | null>(null);
  protected readonly calculando = signal(false);
  protected readonly capturables = computed(() => this.contexto.conceptos().filter((c) => !c.calculado));

  protected agregar(): void {
    this.fijos.update((l) => [...l, { conceptoId: this.capturables()[0]?.id ?? null, importe: 0 }]);
  }

  protected quitar(i: number): void {
    this.fijos.update((l) => l.filter((_, j) => j !== i));
  }

  protected calcular(): void {
    this.calculando.set(true);
    this.api
      .simular({
        tipoNomina: this.contexto.tipoNomina(),
        nivel: this.nivel,
        rango: this.rango,
        dias: this.dias,
        fijos: this.fijos().filter((f) => f.conceptoId && f.importe).map((f) => ({ conceptoId: f.conceptoId!, importe: f.importe })),
      })
      .subscribe({
        next: (r) => {
          this.resultado.set(r);
          this.calculando.set(false);
        },
        error: (e) => {
          this.calculando.set(false);
          this.avisos.error(mensajeDeError(e));
        },
      });
  }
}
