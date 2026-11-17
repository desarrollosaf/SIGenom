import { Component, computed, input } from '@angular/core';

const TRAZOS = {
  inicio: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z',
  personas: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20 M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35 M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  movimientos: 'M7 4v16 M3 8l4-4 4 4 M17 20V4 M21 16l-4 4-4-4',
  captura: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
  calculo: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M8 7h8 M8 12h.01 M12 12h.01 M16 12h.01 M8 16h.01 M12 16h.01 M16 16h.01',
  verificar: 'M9 12l2 2 4-4 M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z',
  calendario: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z M4 10h16 M8 3v4 M16 3v4',
  banco: 'M3 10h18 M5 10v8 M9.5 10v8 M14.5 10v8 M19 10v8 M3 21h18 M12 3l9 5H3l9-5Z',
  reportes: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z M14 3v5h5 M9 17v-3 M12 17v-6 M15 17v-2',
  analisis: 'M3 3v18h18 M7 14l3-3 3 3 6-7 M16 7h3v3',
  simulador: 'M4 19h16 M4 15l4-4 4 3 7-7 M15 7h4v4',
  aumento: 'M12 19V5 M5 12l7-7 7 7',
  catalogos: 'M4 5c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2Z M4 5v14c0 1.1 3.6 2 8 2s8-.9 8-2V5 M4 12c0 1.1 3.6 2 8 2s8-.9 8-2',
  usuarios: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0',
  bitacora: 'M12 8v4l2.5 2.5 M3.05 11a9 9 0 1 1 .5 4 M3 4v4h4',
  buscar: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  cerrar: 'M18 6 6 18 M6 6l12 12',
  mas: 'M12 5v14 M5 12h14',
  flecha: 'M5 12h14 M13 6l6 6-6 6',
  atras: 'M19 12H5 M11 18l-6-6 6-6',
  abajo: 'M6 9l6 6 6-6',
  sol: 'M12 3v2 M12 19v2 M5.6 5.6 7 7 M17 17l1.4 1.4 M3 12h2 M19 12h2 M5.6 18.4 7 17 M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  luna: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z',
  salir: 'M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3 M10 17l-5-5 5-5 M5 12h11',
  descarga: 'M12 4v11 M7 11l5 5 5-5 M4 20h16',
  subir: 'M12 16V5 M7 9l5-5 5 5 M4 20h16',
  pdf: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z M14 3v5h5 M9 13h6 M9 17h4',
  excel: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z M14 3v5h5 M9 12l6 6 M15 12l-6 6',
  listo: 'M5 12.5l4.5 4.5L19 7',
  alerta: 'M12 9v4 M12 17h.01 M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 16v-4 M12 8h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  editar: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z',
  basura: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13 M9 7V4h6v3',
  candado: 'M6 11h12v10H6V11Z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  ojo: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
} as const;

export type NombreIcono = keyof typeof TRAZOS;

@Component({
  selector: 'app-icono',
  template: `<svg
    [attr.width]="tamano()"
    [attr.height]="tamano()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="grosor()"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path [attr.d]="trazo()" />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class Icono {
  readonly nombre = input.required<NombreIcono>();
  readonly tamano = input(18);
  readonly grosor = input(1.7);
  protected readonly trazo = computed(() => TRAZOS[this.nombre()]);
}
