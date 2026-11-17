import { computed, inject, Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import type { Opciones, Periodo } from './modelos';

const CLAVE = 'sigenom_tipo_nomina';

/**
 * La nómina con la que se está trabajando (Principal, Diputados…) y su quincena en curso. Todo el
 * sistema la lee de aquí; el selector de la barra superior la cambia. En el sistema anterior se
 * tecleaba "¿TIPO DE NÓMINA?" en cada pantalla.
 */
@Injectable({ providedIn: 'root' })
export class ContextoService {
  private readonly api = inject(ApiService);

  readonly tipoNomina = signal(this.leer());
  readonly periodo = signal<Periodo | null>(null);
  readonly opciones = signal<Opciones | null>(null);
  readonly cargando = signal(false);

  readonly nombreNomina = computed(
    () => this.opciones()?.tiposNomina.find((t) => t.clave === this.tipoNomina())?.nombre ?? this.tipoNomina(),
  );
  /** Las claves de percepción y deducción de la nómina elegida. */
  readonly conceptos = computed(() =>
    (this.opciones()?.conceptos ?? []).filter((c) => c.tipoNomina === this.tipoNomina()),
  );
  readonly abierto = computed(() => !!this.periodo() && this.periodo()!.estado !== 'cerrado');

  iniciar(): void {
    this.api.opciones().subscribe((o) => this.opciones.set(o));
    this.recargarPeriodo();
  }

  elegir(clave: string): void {
    this.tipoNomina.set(clave);
    try {
      localStorage.setItem(CLAVE, clave);
    } catch {
      // Sin almacenamiento la elección solo dura esta visita.
    }
    this.recargarPeriodo();
  }

  recargarPeriodo(): void {
    this.cargando.set(true);
    this.api.periodoActual(this.tipoNomina()).subscribe({
      next: (p) => {
        this.periodo.set(p);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  recargarOpciones(): void {
    this.api.opciones().subscribe((o) => this.opciones.set(o));
  }

  private leer(): string {
    try {
      return localStorage.getItem(CLAVE) ?? 'P';
    } catch {
      return 'P';
    }
  }
}
