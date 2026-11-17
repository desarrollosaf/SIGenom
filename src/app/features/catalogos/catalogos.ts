import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { CampoCatalogo, DefinicionCatalogo } from '../../core/services/modelos';
import { Cajon } from '../../shared/cajon/cajon';
import { FORMATO, MonedaPipe } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';

/**
 * Todos los catálogos con una sola pantalla. En el sistema anterior eran once programas casi
 * iguales (1ABC-ISP, 1ABC-PUE, 1ABC-PD, 1ABC-ADS, 1ABC-NIR, 1ABC-CRE, 1ABC-MOT…); aquí el backend
 * describe cada catálogo y esta pantalla arma la tabla y el formulario.
 */
@Component({
  selector: 'app-catalogos',
  imports: [FormsModule, RouterLink, Icono, Cajon, ...FORMATO],
  templateUrl: './catalogos.html',
  styleUrl: './catalogos.scss',
})
export class Catalogos {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly router = inject(Router);
  protected readonly contexto = inject(ContextoService);
  private readonly moneda = new MonedaPipe();

  readonly clave = input<string>();

  protected readonly definiciones = signal<DefinicionCatalogo[]>([]);
  protected readonly filas = signal<Record<string, unknown>[]>([]);
  protected readonly filtro = signal('');
  protected readonly editando = signal<Record<string, unknown> | null>(null);
  protected readonly esNuevo = signal(false);
  /** La llave del renglón que se edita. No siempre es un campo del formulario (p. ej. el id interno). */
  private idEditando: string | undefined;
  protected readonly guardando = signal(false);

  protected readonly actual = computed(() => this.definiciones().find((d) => d.clave === this.clave()) ?? null);
  protected readonly columnas = computed(() => this.actual()?.campos.filter((c) => !c.soloFormulario) ?? []);
  protected readonly visibles = computed(() => {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return this.filas();
    return this.filas().filter((f) => Object.values(f).some((v) => String(v ?? '').toLowerCase().includes(q)));
  });

  constructor() {
    this.cargarDefiniciones();
    effect(() => {
      const def = this.actual();
      const tipo = this.contexto.tipoNomina();
      this.filtro.set('');
      if (def) this.api.catalogo(def.clave, def.porTipoNomina ? tipo : undefined).subscribe((f) => this.filas.set(f));
    });
  }

  private cargarDefiniciones(): void {
    this.api.catalogos().subscribe((d) => this.definiciones.set(d));
  }

  protected abrir(fila?: Record<string, unknown>): void {
    const def = this.actual()!;
    this.esNuevo.set(!fila);
    this.idEditando = fila ? String(fila[def.llave]) : undefined;
    const base: Record<string, unknown> = {};
    for (const c of def.campos) {
      const valor = fila ? fila[c.clave] : c.tipo === 'booleano' ? true : c.clave === 'tipoNomina' ? this.contexto.tipoNomina() : '';
      base[c.clave] = c.tipo === 'booleano' ? valor : (valor ?? '');
    }
    this.editando.set(base);
  }

  protected guardar(): void {
    const def = this.actual()!;
    const datos = { ...this.editando()! };
    const id = this.esNuevo() ? undefined : this.idEditando;
    this.guardando.set(true);
    this.api.guardarRenglon(def.clave, datos, id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.editando.set(null);
        this.avisos.exito('Guardado.');
        this.recargar();
      },
      error: (e) => {
        this.guardando.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }

  protected async borrar(): Promise<void> {
    const def = this.actual()!;
    const ok = await this.avisos.confirmar({ titulo: 'Eliminar registro', texto: 'Si algún empleado o recibo lo usa, no se podrá eliminar; en ese caso desactívalo.', accion: 'Eliminar', peligro: true });
    if (!ok) return;
    this.api.borrarRenglon(def.clave, this.idEditando!).subscribe({
      next: () => {
        this.editando.set(null);
        this.avisos.exito('Eliminado.');
        this.recargar();
      },
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }

  protected ir(clave: string): void {
    void this.router.navigate(['/catalogos', clave]);
  }

  protected mostrar(campo: CampoCatalogo, fila: Record<string, unknown>): string {
    const v = fila[campo.clave];
    if (v === null || v === undefined || v === '') return '—';
    if (campo.tipo === 'booleano') return v ? 'Sí' : 'No';
    if (campo.tipo === 'dinero') return this.moneda.transform(Number(v));
    if (campo.tipo === 'opcion' && Array.isArray(campo.opciones)) return campo.opciones.find((o) => o.valor === String(v))?.etiqueta ?? String(v);
    return String(v);
  }

  protected opciones(campo: CampoCatalogo) {
    if (campo.opciones === 'tiposNomina') return (this.contexto.opciones()?.tiposNomina ?? []).map((t) => ({ valor: t.clave, etiqueta: t.nombre }));
    return campo.opciones ?? [];
  }

  protected tipoInput(campo: CampoCatalogo): string {
    return campo.tipo === 'fecha' ? 'date' : campo.tipo === 'texto' ? 'text' : 'number';
  }

  private recargar(): void {
    const def = this.actual();
    if (def) this.api.catalogo(def.clave, def.porTipoNomina ? this.contexto.tipoNomina() : undefined).subscribe((f) => this.filas.set(f));
    this.cargarDefiniciones();
    this.contexto.recargarOpciones();
  }
}
