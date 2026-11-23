import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import type { ResultadoTablaRang } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';

/** Carga la tabla-rang (CSV o tabla-rang.txt del respaldo) como una vigencia nueva del tabulador. */
@Component({
  selector: 'app-importar-tabla-rang',
  imports: [FormsModule, ...FORMATO],
  template: `
    <div class="formulario uno">
      <div>
        <label class="etiqueta" for="rang-archivo">Archivo de la tabla-rang</label>
        <input id="rang-archivo" class="campo archivo" type="file" accept=".csv,.txt" (change)="elegir($event)" />
        <p class="ayuda">El CSV de Excel (NIVEL; IMP-NIVEL; IMP-RAN…) o el tabla-rang.txt del respaldo de la quincena.</p>
      </div>
      <div>
        <label class="etiqueta" for="rang-vigencia">Vigente desde</label>
        <input id="rang-vigencia" class="campo" type="date" [(ngModel)]="vigencia" (ngModelChange)="resultado.set(null)" />
        <p class="ayuda">El primer día de la primera quincena que se paga con estos sueldos.</p>
      </div>
      <div class="barra-filtros">
        <button type="button" class="boton" [disabled]="!archivo || !vigencia || ocupado()" (click)="enviar(false)">Revisar</button>
        @if (resultado(); as r) {
          @if (!r.aplicado && r.nuevos + r.cambian > 0) {<button type="button" class="boton primario" [disabled]="ocupado()" (click)="enviar(true)">Guardar tabla</button>}
        }
      </div>
    </div>
    @if (resultado(); as r) {
      <p class="nota" style="margin-top: 12px">
        {{ r.aplicado ? 'Guardada.' : 'Todavía no se guarda nada.' }} {{ r.niveles }} niveles: {{ r.cambian }} renglones cambian, {{ r.nuevos }} son nuevos y {{ r.iguales }} quedan igual.
      </p>
      @if (r.faltan.length) {<p class="nota ambar" style="margin-top: 8px">No vienen en el archivo los niveles {{ r.faltan.join(', ') }}; siguen con la tabla anterior.</p>}
      @if (r.muestra.length) {
        <table class="tabla" style="margin-top: 12px">
          <thead><tr><th>Nivel</th><th class="der">Sueldo quincenal antes</th><th class="der">Después</th><th class="der">Cambio</th></tr></thead>
          <tbody>
            @for (m of r.muestra; track m.nivel) {
              <tr><td class="mono">{{ m.nivel }}</td><td class="der cifra tenue">{{ m.antes === null ? '—' : (m.antes | moneda) }}</td><td class="der cifra">{{ m.despues | moneda }}</td><td class="der mono">{{ m.antes ? (((m.despues / m.antes) - 1) * 100).toFixed(2) + ' %' : 'nuevo' }}</td></tr>
            }
          </tbody>
        </table>
      }
    }
  `,
})
export class ImportarTablaRang {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  readonly guardada = output<void>();
  protected readonly resultado = signal<ResultadoTablaRang | null>(null);
  protected readonly ocupado = signal(false);
  protected archivo: File | null = null;
  protected vigencia = '';

  protected elegir(e: Event): void {
    this.archivo = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.resultado.set(null);
  }

  protected enviar(aplicar: boolean): void {
    if (!this.archivo) return;
    this.ocupado.set(true);
    this.api.importarTablaRang(this.archivo, this.vigencia, aplicar).subscribe({
      next: (r) => {
        this.ocupado.set(false);
        this.resultado.set(r);
        if (r.aplicado) {
          this.avisos.exito(`Tabulador guardado, vigente desde ${r.vigencia}.`);
          this.guardada.emit();
        }
      },
      error: (e) => {
        this.ocupado.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }
}
