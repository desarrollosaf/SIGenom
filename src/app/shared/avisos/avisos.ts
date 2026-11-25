import { Component, effect, ElementRef, inject, viewChild } from '@angular/core';
import { AvisosService } from '../../core/services/avisos.service';
import { Icono } from '../icono/icono';

/** Avisos flotantes y el diálogo de confirmación. */
@Component({
  selector: 'app-avisos',
  imports: [Icono],
  template: `
    <div #pila class="pila" popover="manual" aria-live="polite">
      @for (aviso of servicio.avisos(); track aviso.id) {
        <div class="aviso" [class.error]="aviso.tipo === 'error'" role="status">
          <app-icono [nombre]="aviso.tipo === 'error' ? 'alerta' : 'listo'" [tamano]="16" />
          <span>{{ aviso.texto }}</span>
        </div>
      }
    </div>

    <dialog #dialogo class="dialogo" (cancel)="responder(false)">
      @if (servicio.confirmacion(); as c) {
        <h2 class="titulo-medio">{{ c.titulo }}</h2>
        <p>{{ c.texto }}</p>
        <div class="acciones">
          <button type="button" class="boton" (click)="responder(false)">Cancelar</button>
          <button
            type="button"
            class="boton"
            [class.primario]="!c.peligro"
            [class.peligro]="c.peligro"
            (click)="responder(true)"
          >
            {{ c.accion }}
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .pila {
      position: fixed;
      inset: auto 20px 20px auto;
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      overflow: visible;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      width: min(calc(100vw - 32px), 420px);
      pointer-events: none;
    }
    .pila:popover-open {
      display: flex;
    }
    .aviso {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 11px 14px;
      border-radius: 9px;
      background: var(--tinta);
      color: var(--fondo);
      font-size: 0.875rem;
      box-shadow: 0 10px 30px rgb(0 0 0 / 20%);
      animation: entrar 0.2s ease;
    }
    .aviso app-icono {
      margin-top: 2px;
    }
    .aviso.error {
      background: var(--rojo);
      color: #fff;
    }
    @keyframes entrar {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
    }
    .dialogo {
      width: min(calc(100vw - 32px), 440px);
      padding: 24px;
      border: 1px solid var(--linea);
      border-radius: 12px;
      background: var(--superficie);
      color: var(--tinta);
      box-shadow: var(--sombra);
    }
    .dialogo::backdrop {
      background: rgb(8 14 12 / 45%);
      backdrop-filter: blur(2px);
    }
    .dialogo p {
      margin: 8px 0 22px;
      color: var(--apagado);
      font-size: 0.9375rem;
    }
    .acciones {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    @media (max-width: 640px) {
      .pila {
        inset: auto 16px 16px;
        width: auto;
        align-items: stretch;
      }
    }
  `,
})
export class Avisos {
  protected readonly servicio = inject(AvisosService);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  private readonly pila = viewChild.required<ElementRef<HTMLElement>>('pila');

  constructor() {
    // Con cada aviso se vuelve a mostrar: así queda por encima de cualquier ventana o cajón abierto.
    effect(() => {
      const hay = this.servicio.avisos().length > 0;
      const pila = this.pila().nativeElement;
      if (pila.matches(':popover-open')) pila.hidePopover();
      if (hay) pila.showPopover();
    });
    effect(() => {
      const elemento = this.dialogo().nativeElement;
      if (this.servicio.confirmacion()) {
        if (!elemento.open) elemento.showModal();
      } else if (elemento.open) {
        elemento.close();
      }
    });
  }

  protected responder(acepto: boolean): void {
    this.servicio.confirmacion()?.responder(acepto);
  }
}
