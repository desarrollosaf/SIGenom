import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { FORMATO } from '../../shared/formato';

type Renglon = { id: number; nivel: number; rango: number; sueldoAntes: number; sueldoDespues: number; compensacionAntes: number; compensacionDespues: number };

/** Aumento salarial general (1CAL-A-S.W): se ve el tabulador antes y después, y solo entonces se aplica. */
@Component({
  selector: 'app-aumento',
  imports: [FormsModule, ...FORMATO],
  template: `
    <div class="pagina angosta">
      <header class="encabezado">
        <div>
          <p class="antetitulo">Configuración</p>
          <h1 class="titulo">Aumento salarial general</h1>
          <p class="apagado">Sube el tabulador por porcentaje. Quien tenga ese nivel y rango lo recibe en el siguiente cálculo; no se toca a cada empleado.</p>
        </div>
      </header>

      <section class="tarjeta con-relleno">
        <div class="formulario">
          <div><label class="etiqueta">Porcentaje</label><input class="campo cifra" type="number" step="0.01" min="0" [(ngModel)]="porcentaje" /></div>
          <div>
            <label class="etiqueta">Niveles</label>
            <input class="campo mono" placeholder="Todos, o p. ej. 1-10, 14" [(ngModel)]="niveles" />
            <p class="ayuda">Vacío: todo el tabulador.</p>
          </div>
          <div class="ancho"><label class="casilla"><input type="checkbox" [(ngModel)]="compensacion" />Aplicar también a la compensación</label></div>
        </div>
        <div class="acciones" style="margin-top: 14px; justify-content: flex-end">
          <button type="button" class="boton" [disabled]="!porcentaje" (click)="previsualizar()">Ver cómo queda</button>
          @if (esAdmin() && renglones().length) {
            <button type="button" class="boton primario" (click)="aplicar()">Aplicar aumento</button>
          }
        </div>
        @if (!esAdmin()) {<p class="ayuda" style="text-align: right">Solo un administrador puede aplicarlo.</p>}
      </section>

      @if (renglones().length) {
        <section class="seccion">
          <div class="cifras" style="margin-bottom: 12px">
            <div class="cifra-bloque"><span class="antetitulo">Renglones del tabulador</span><span class="valor">{{ renglones().length }}</span></div>
            <div class="cifra-bloque"><span class="antetitulo">Empleados en esos niveles</span><span class="valor">{{ empleados() | numero }}</span></div>
            <div class="cifra-bloque"><span class="antetitulo">Costo mensual adicional aprox.</span><span class="valor">{{ costo() | moneda }}</span><p class="nota">Suponiendo un empleado por renglón</p></div>
          </div>
          <div class="tabla-marco" style="max-height: 60vh">
            <table class="tabla">
              <thead><tr><th>Nivel</th><th>Rango</th><th class="der">Sueldo actual</th><th class="der">Sueldo nuevo</th><th class="der">Compensación nueva</th></tr></thead>
              <tbody>
                @for (r of renglones(); track r.id) {
                  <tr>
                    <td class="mono">{{ r.nivel }}</td><td class="mono">{{ r.rango }}</td>
                    <td class="der cifra tenue">{{ r.sueldoAntes | moneda }}</td>
                    <td class="der cifra principal">{{ r.sueldoDespues | moneda }}</td>
                    <td class="der cifra">{{ r.compensacionDespues | moneda }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </div>
  `,
})
export class Aumento {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly auth = inject(AuthService);
  protected readonly esAdmin = computed(() => !!this.auth.currentUser()?.capacidades.administrar);

  protected porcentaje: number | null = null;
  protected niveles = '';
  protected compensacion = false;
  protected readonly renglones = signal<Renglon[]>([]);
  protected readonly empleados = signal(0);
  protected readonly costo = computed(() =>
    this.renglones().reduce((s, r) => s + (r.sueldoDespues - r.sueldoAntes) + (r.compensacionDespues - r.compensacionAntes), 0),
  );

  /** "1-10, 14" -> [1..10, 14] */
  private listaNiveles(): number[] | undefined {
    const lista = this.niveles
      .split(',')
      .flatMap((parte) => {
        const [a, b] = parte.split('-').map((x) => Number(x.trim()));
        if (!a) return [];
        return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
      })
      .filter((n) => Number.isInteger(n) && n > 0);
    return lista.length ? lista : undefined;
  }

  private datos() {
    return { porcentaje: Number(this.porcentaje), niveles: this.listaNiveles(), incluirCompensacion: this.compensacion };
  }

  protected previsualizar(): void {
    this.api.vistaAumento(this.datos()).subscribe({
      next: (r) => {
        this.renglones.set(r.renglones);
        this.empleados.set(r.empleados);
      },
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }

  protected async aplicar(): Promise<void> {
    const ok = await this.avisos.confirmar({
      titulo: `Aplicar ${this.porcentaje} % de aumento`,
      texto: `Se actualizan ${this.renglones().length} renglones del tabulador. Queda en la bitácora.`,
      accion: 'Aplicar',
    });
    if (!ok) return;
    this.api.aplicarAumento(this.datos()).subscribe({
      next: (r) => {
        this.avisos.exito(`Tabulador actualizado: ${r.actualizados} renglones.`);
        this.renglones.set([]);
      },
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }
}
