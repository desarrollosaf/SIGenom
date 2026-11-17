import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import type { RegistroBitacora } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';

/** Quién cambió qué. Sustituye a H-mov y H-perded, que solo guardaban cambios de nómina. */
@Component({
  selector: 'app-bitacora',
  imports: [FormsModule, ...FORMATO],
  template: `
    <div class="pagina">
      <header class="encabezado">
        <div>
          <p class="antetitulo">Configuración</p>
          <h1 class="titulo">Bitácora</h1>
          <p class="apagado">Cada alta, cambio, baja, cálculo y cierre, con su usuario y el valor anterior.</p>
        </div>
      </header>
      <div class="barra-filtros">
        <select class="campo" [ngModel]="entidad()" (ngModelChange)="entidad.set($event); desde.set(0)" aria-label="Qué">
          <option value="">Todo</option>
          <option value="empleado">Empleados</option>
          <option value="captura">Capturas</option>
          <option value="periodo">Quincenas y cálculos</option>
          <option value="catalogo">Catálogos</option>
          <option value="tabulador">Tabulador</option>
          <option value="usuario">Usuarios</option>
        </select>
        <input class="campo" placeholder="Usuario" [ngModel]="usuario()" (ngModelChange)="usuario.set($event); desde.set(0)" />
      </div>
      <div class="tabla-marco">
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Qué</th><th>Acción</th><th>Antes</th><th>Después</th></tr></thead>
          <tbody>
            @for (r of registros(); track r.id) {
              <tr>
                <td class="chico mono">{{ r.fecha | fecha: true }}</td>
                <td class="mono">{{ r.usuario }}</td>
                <td>{{ r.entidad }} <span class="tenue mono">{{ r.entidadId }}</span></td>
                <td><span class="insignia sin-punto">{{ r.accion.replace('_', ' ') }}</span></td>
                <td class="mono chico tenue json">{{ texto(r.antes) }}</td>
                <td class="mono chico json">{{ texto(r.despues) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="tenue">Sin registros.</td></tr>
            }
          </tbody>
        </table>
      </div>
      <div class="paginacion">
        <span></span>
        <div class="acciones">
          <button type="button" class="boton chico" [disabled]="desde() === 0" (click)="desde.set(desde() - 100)">Más recientes</button>
          <button type="button" class="boton chico" [disabled]="registros().length < 100" (click)="desde.set(desde() + 100)">Anteriores</button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .json {
      max-width: 280px;
      overflow-wrap: anywhere;
    }
  `,
})
export class BitacoraPagina {
  private readonly api = inject(ApiService);
  protected readonly registros = signal<RegistroBitacora[]>([]);
  protected readonly entidad = signal('');
  protected readonly usuario = signal('');
  protected readonly desde = signal(0);

  constructor() {
    effect(() => {
      this.api.bitacora({ entidad: this.entidad(), usuario: this.usuario(), desde: this.desde() }).subscribe((r) => this.registros.set(r));
    });
  }

  protected texto(valor: Record<string, unknown> | null): string {
    if (!valor) return '';
    return Object.entries(valor)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' · ');
  }
}
