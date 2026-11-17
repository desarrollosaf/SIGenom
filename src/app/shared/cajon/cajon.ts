import { Component, effect, ElementRef, input, output, viewChild } from '@angular/core';
import { Icono } from '../icono/icono';

/** Panel lateral para formularios y detalle, sin salir de la pantalla. */
@Component({
  selector: 'app-cajon',
  imports: [Icono],
  template: `
    <dialog #dialogo class="cajon" [class.ancho]="ancho()" (cancel)="$event.preventDefault(); cerrar.emit()" (click)="fuera($event)">
      <div class="contenido">
        <header>
          <div>
            @if (antetitulo()) {
              <p class="antetitulo">{{ antetitulo() }}</p>
            }
            <h2 class="titulo-medio">{{ titulo() }}</h2>
          </div>
          <button type="button" class="boton-icono" (click)="cerrar.emit()" aria-label="Cerrar">
            <app-icono nombre="cerrar" />
          </button>
        </header>
        <div class="cuerpo">
          <ng-content />
        </div>
        <footer>
          <ng-content select="[pie]" />
        </footer>
      </div>
    </dialog>
  `,
  styles: `
    .cajon {
      width: min(100vw, 520px);
      max-width: none;
      height: 100dvh;
      max-height: none;
      margin: 0 0 0 auto;
      padding: 0;
      border: 0;
      border-left: 1px solid var(--linea);
      background: var(--superficie);
      color: var(--tinta);
      box-shadow: var(--sombra);
    }
    .cajon.ancho {
      width: min(100vw, 760px);
    }
    .cajon[open] {
      animation: deslizar 0.2s ease;
    }
    .cajon::backdrop {
      background: rgb(8 14 12 / 35%);
    }
    @keyframes deslizar {
      from {
        transform: translateX(24px);
        opacity: 0;
      }
    }
    .contenido {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 20px 22px 16px;
      border-bottom: 1px solid var(--linea);
    }
    .cuerpo {
      flex: 1;
      padding: 20px 22px;
      overflow-y: auto;
    }
    footer:not(:empty) {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 22px;
      border-top: 1px solid var(--linea);
    }
  `,
})
export class Cajon {
  readonly abierto = input(false);
  readonly titulo = input('');
  readonly antetitulo = input('');
  readonly ancho = input(false);
  readonly cerrar = output<void>();
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');

  constructor() {
    effect(() => {
      const elemento = this.dialogo().nativeElement;
      if (this.abierto() && !elemento.open) elemento.showModal();
      if (!this.abierto() && elemento.open) elemento.close();
    });
  }

  /** Clic en el fondo oscuro: cierra. */
  protected fuera(evento: MouseEvent): void {
    if (evento.target === this.dialogo().nativeElement) this.cerrar.emit();
  }
}
