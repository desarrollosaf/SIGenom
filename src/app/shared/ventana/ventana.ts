import { Component, effect, ElementRef, input, output, viewChild } from '@angular/core';
import { Icono } from '../icono/icono';

/** Ventana amplia sobre la pantalla, para un trabajo completo sin salir de donde se estaba. */
@Component({
  selector: 'app-ventana',
  imports: [Icono],
  template: `
    <dialog #dialogo class="ventana" [attr.aria-label]="titulo()" (cancel)="$event.preventDefault(); cerrar.emit()" (click)="fuera($event)">
      <div class="contenido">
        <header>
          <button type="button" class="boton fantasma chico" (click)="cerrar.emit()"><app-icono nombre="atras" [tamano]="15" />{{ regresar() }}</button>
          <div class="nombre">
            <h2 class="titulo-medio">{{ titulo() }}</h2>
            @if (subtitulo()) {<p class="apagado chico">{{ subtitulo() }}</p>}
          </div>
          <button type="button" class="boton-icono" (click)="cerrar.emit()" aria-label="Cerrar"><app-icono nombre="cerrar" /></button>
        </header>
        <div class="cuerpo"><ng-content /></div>
      </div>
    </dialog>
  `,
  styles: `
    .ventana {
      width: min(calc(100vw - 48px), 1180px);
      max-width: none;
      height: min(calc(100dvh - 48px), 900px);
      max-height: none;
      padding: 0;
      border: 1px solid var(--linea);
      border-radius: 18px;
      background: var(--fondo);
      color: var(--tinta);
      box-shadow: 0 24px 80px -20px rgb(8 14 12 / 45%);
      overflow: hidden;
    }
    .ventana[open] { animation: subir 0.22s ease; }
    .ventana::backdrop { background: rgb(8 14 12 / 45%); backdrop-filter: blur(3px); }
    @keyframes subir {
      from { opacity: 0; transform: translateY(14px) scale(0.985); }
    }
    .contenido { display: flex; flex-direction: column; height: 100%; }
    header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 14px 18px; border-bottom: 1px solid var(--linea); background: var(--superficie); }
    .nombre p { margin: 0; }
    .cuerpo { flex: 1; padding: 24px; overflow-y: auto; }
    @media (max-width: 700px) {
      .ventana { width: 100vw; height: 100dvh; margin: 0; border: 0; border-radius: 0; }
      .cuerpo { padding: 16px; }
      .nombre p { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .ventana[open] { animation: none; } }
  `,
})
export class Ventana {
  readonly abierta = input(false);
  readonly titulo = input('');
  readonly subtitulo = input('');
  readonly regresar = input('Regresar');
  readonly cerrar = output<void>();
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');

  constructor() {
    effect(() => {
      const d = this.dialogo().nativeElement;
      if (this.abierta() && !d.open) d.showModal();
      if (!this.abierta() && d.open) d.close();
    });
  }

  protected fuera(e: MouseEvent): void {
    if (e.target === this.dialogo().nativeElement) this.cerrar.emit();
  }
}
