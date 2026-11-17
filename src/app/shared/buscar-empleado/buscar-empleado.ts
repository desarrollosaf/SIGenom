import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import type { EmpleadoResumen } from '../../core/services/modelos';
import { Icono } from '../icono/icono';

/** Busca por nombre, CURP o RFC dentro de una nómina y avisa cuál se eligió. */
@Component({
  selector: 'app-buscar-empleado',
  imports: [Icono],
  template: `
    <div class="caja" (focusout)="salir($event)">
      <app-icono nombre="buscar" [tamano]="16" class="lupa" />
      <input
        class="campo"
        [placeholder]="marcador()"
        [value]="texto()"
        (input)="escribir($any($event.target).value)"
        (keydown)="tecla($event)"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        [attr.aria-expanded]="abierto()"
      />
      @if (abierto() && resultados().length) {
        <ul class="lista" role="listbox">
          @for (e of resultados(); track e.id; let i = $index) {
            <li role="option" [class.activo]="i === indice()" [attr.aria-selected]="i === indice()" (mousedown)="elegir(e)">
              <span class="nombre">{{ e.nombre }}</span>
              <span class="mono tenue chico">{{ e.curp }} · N{{ e.nivel }}</span>
              @if (e.estado !== 'activo') {
                <span class="insignia sin-punto" [class.rojo]="e.estado === 'baja'" [class.ambar]="e.estado === 'permiso'">{{ e.estado }}</span>
              }
            </li>
          }
        </ul>
      } @else if (abierto() && texto().length >= 2 && !buscando()) {
        <div class="lista vacia">Sin coincidencias</div>
      }
    </div>
  `,
  styles: `
    .caja {
      position: relative;
    }
    .lupa {
      position: absolute;
      top: 50%;
      left: 11px;
      color: var(--tenue);
      transform: translateY(-50%);
      pointer-events: none;
    }
    .campo {
      padding-left: 34px;
    }
    .lista {
      position: absolute;
      z-index: 30;
      top: calc(100% + 4px);
      right: 0;
      left: 0;
      max-height: 320px;
      margin: 0;
      padding: 4px;
      border: 1px solid var(--linea);
      border-radius: 9px;
      background: var(--superficie);
      box-shadow: var(--sombra);
      list-style: none;
      overflow-y: auto;
    }
    .vacia {
      padding: 12px;
      color: var(--apagado);
      font-size: 0.875rem;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px 10px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    li.activo,
    li:hover {
      background: var(--fondo-2);
    }
    .nombre {
      flex: 1 1 100%;
      font-size: 0.875rem;
      font-weight: 500;
    }
  `,
})
export class BuscarEmpleado {
  private readonly api = inject(ApiService);

  readonly tipoNomina = input<string>();
  readonly marcador = input('Nombre, CURP o RFC');
  /** Incluir bajas en la búsqueda (para consulta). */
  readonly todos = input(false);
  readonly elegido = output<EmpleadoResumen>();

  protected readonly texto = signal('');
  protected readonly resultados = signal<EmpleadoResumen[]>([]);
  protected readonly abierto = signal(false);
  protected readonly buscando = signal(false);
  protected readonly indice = signal(0);
  private readonly consultas = new Subject<string>();

  constructor() {
    const sub = this.consultas
      .pipe(
        debounceTime(220),
        distinctUntilChanged(),
        switchMap((q) => {
          if (q.trim().length < 2) return of({ total: 0, empleados: [] });
          this.buscando.set(true);
          return this.api.empleados({ q, tipoNomina: this.tipoNomina(), estado: this.todos() ? 'todos' : undefined, limite: 8 });
        }),
      )
      .subscribe((r) => {
        this.resultados.set(r.empleados);
        this.indice.set(0);
        this.buscando.set(false);
      });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  protected escribir(valor: string): void {
    this.texto.set(valor);
    this.abierto.set(true);
    this.consultas.next(valor);
  }

  protected tecla(evento: KeyboardEvent): void {
    const lista = this.resultados();
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      this.indice.set(Math.min(this.indice() + 1, lista.length - 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      this.indice.set(Math.max(this.indice() - 1, 0));
    } else if (evento.key === 'Enter' && lista[this.indice()]) {
      evento.preventDefault();
      this.elegir(lista[this.indice()]);
    } else if (evento.key === 'Escape') {
      this.abierto.set(false);
    }
  }

  protected elegir(empleado: EmpleadoResumen): void {
    this.elegido.emit(empleado);
    this.texto.set('');
    this.resultados.set([]);
    this.abierto.set(false);
  }

  protected salir(evento: FocusEvent): void {
    if (!(evento.currentTarget as HTMLElement).contains(evento.relatedTarget as Node)) this.abierto.set(false);
  }

  /** Para que la pantalla pueda limpiar o poner el foco desde fuera. */
  limpiar(): void {
    this.texto.set('');
    this.resultados.set([]);
  }
}
