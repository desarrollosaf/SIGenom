import { Component, computed, effect, inject, signal, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { Diagnostico } from '../../core/services/modelos';
import { Icono } from '../../shared/icono/icono';

/** Diagnósticos antes de pagar: 1DIAG-CA, 1Diag-ap, 1VERI-CA, 1VER-NOM y 1RE-E-CB en una sola vista. */
@Component({
  selector: 'app-verificacion',
  imports: [RouterLink, Icono],
  template: `
    <div [class.pagina]="!incrustado()">
      @if (!incrustado()) {
      <header class="encabezado">
        <div>
          <p class="antetitulo">Quincena · {{ contexto.nombreNomina() }}</p>
          <h1 class="titulo">Verificación</h1>
          <p class="apagado">Revisiones de la quincena en curso. Los errores conviene corregirlos antes de calcular la nómina definitiva.</p>
        </div>
        <button type="button" class="boton" (click)="cargar()" [disabled]="cargando()">Volver a revisar</button>
      </header>
      }

      @if (!contexto.periodo()) {
        <div class="tarjeta vacio"><p class="titulo-chico">No hay quincena abierta</p></div>
      } @else if (cargando() && !lista().length) {
        <div class="esqueleto" style="height: 80px"></div>
        <div class="esqueleto" style="height: 80px"></div>
      } @else {
        <div class="cifras" style="margin-bottom: 16px">
          <div class="cifra-bloque"><span class="antetitulo">Errores</span><span class="valor" [class.negativo]="resumen().errores">{{ resumen().errores }}</span><p class="nota">Revisiones con casos que impiden pagar bien</p></div>
          <div class="cifra-bloque"><span class="antetitulo">Avisos</span><span class="valor" [style.color]="resumen().avisos ? 'var(--ambar)' : ''">{{ resumen().avisos }}</span><p class="nota">Conviene revisarlos</p></div>
          <div class="cifra-bloque"><span class="antetitulo">Sin observaciones</span><span class="valor" style="color: var(--acento)">{{ resumen().limpias }}</span><p class="nota">de {{ lista().length }} revisiones</p></div>
        </div>
        @if (!calculoId()) {
          <p class="nota" style="margin-bottom: 16px"><app-icono nombre="info" [tamano]="16" />Algunas revisiones necesitan un cálculo: corre la prenómina para verlas todas.</p>
        }

        <div class="lista">
          @for (d of lista(); track d.clave) {
            <details class="tarjeta diag" [class.error]="d.severidad === 'error' && d.total" [class.aviso]="d.severidad === 'aviso' && d.total" [open]="d.total > 0 && d.severidad === 'error'">
              <summary>
                <span class="marca">
                  @if (d.total === 0) {<app-icono nombre="listo" [tamano]="16" [grosor]="2.2" />}
                  @else {<app-icono nombre="alerta" [tamano]="16" />}
                </span>
                <span class="texto">
                  <strong>{{ d.titulo }}</strong>
                  <small>{{ d.descripcion }} · <span class="mono">{{ d.legado }}</span></small>
                </span>
                <span class="cuenta mono">{{ d.total }}</span>
              </summary>
              @if (d.total) {
                <table class="tabla">
                  <tbody>
                    @for (m of d.muestras; track $index) {
                      <tr>
                        <td>
                          @if (m.empleadoId) {<a [routerLink]="['/empleados', m.empleadoId]">{{ m.nombre }}</a>}
                          @else {<a routerLink="/catalogos/conceptos">{{ m.nombre }}</a>}
                        </td>
                        <td class="apagado">{{ m.detalle }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
                @if (d.total > d.muestras.length) {<p class="tenue chico" style="padding: 8px 16px">y {{ d.total - d.muestras.length }} más…</p>}
              }
            </details>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .lista {
      display: grid;
      gap: 8px;
    }
    .diag summary {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      list-style: none;
      cursor: pointer;
    }
    .diag summary::-webkit-details-marker {
      display: none;
    }
    .marca {
      display: grid;
      flex: none;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--acento-suave);
      color: var(--acento);
    }
    .error .marca {
      background: var(--rojo-suave);
      color: var(--rojo);
    }
    .aviso .marca {
      background: var(--ambar-suave);
      color: var(--ambar);
    }
    .texto {
      flex: 1;
    }
    .texto strong,
    .texto small {
      display: block;
    }
    .texto small {
      color: var(--apagado);
      font-size: 0.8125rem;
    }
    .cuenta {
      min-width: 32px;
      font-size: 1.125rem;
      text-align: right;
    }
    .error .cuenta {
      color: var(--rojo);
    }
    .aviso .cuenta {
      color: var(--ambar);
    }
    .diag .tabla {
      border-top: 1px solid var(--linea);
    }
    .diag a {
      color: var(--tinta);
      font-weight: 500;
      text-decoration: none;
    }
    .diag a:hover {
      color: var(--acento);
    }
  `,
})
export class Verificacion {
  /** Dentro del asistente de Proceso de nómina: sin encabezado de página. */
  readonly incrustado = input(false);
  private readonly api = inject(ApiService);
  protected readonly contexto = inject(ContextoService);
  protected readonly lista = signal<Diagnostico[]>([]);
  protected readonly calculoId = signal<number | null>(null);
  protected readonly cargando = signal(false);

  protected readonly resumen = computed(() => {
    const l = this.lista();
    return {
      errores: l.filter((d) => d.severidad === 'error' && d.total).length,
      avisos: l.filter((d) => d.severidad === 'aviso' && d.total).length,
      limpias: l.filter((d) => !d.total).length,
    };
  });

  constructor() {
    effect(() => {
      if (this.contexto.periodo()) this.cargar();
    });
  }

  protected cargar(): void {
    const p = this.contexto.periodo();
    if (!p) return;
    this.cargando.set(true);
    this.api.diagnosticos(p.id).subscribe({
      next: (r) => {
        // Primero lo que tiene casos, errores antes que avisos.
        this.lista.set([...r.diagnosticos].sort((a, b) => Number(!a.total) - Number(!b.total) || b.severidad.localeCompare(a.severidad)));
        this.calculoId.set(r.calculoId);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
