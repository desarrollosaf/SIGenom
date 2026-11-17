import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { ContextoService } from '../../../core/services/contexto.service';
import type { EmpleadoResumen } from '../../../core/services/modelos';
import { FORMATO } from '../../../shared/formato';
import { Icono } from '../../../shared/icono/icono';

const POR_PAGINA = 50;

@Component({
  selector: 'app-lista-empleados',
  imports: [FormsModule, RouterLink, Icono, ...FORMATO],
  templateUrl: './lista.html',
})
export class ListaEmpleados {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);

  protected readonly q = signal('');
  protected readonly estado = signal('');
  protected readonly adscripcion = signal('');
  protected readonly pagina = signal(0);
  protected readonly empleados = signal<EmpleadoResumen[]>([]);
  protected readonly total = signal(0);
  protected readonly cargando = signal(true);
  protected readonly paginas = computed(() => Math.max(1, Math.ceil(this.total() / POR_PAGINA)));
  private espera: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const filtro = {
        tipoNomina: this.contexto.tipoNomina(),
        q: this.q(),
        estado: this.estado() || undefined,
        adscripcionId: this.adscripcion() ? Number(this.adscripcion()) : undefined,
        limite: POR_PAGINA,
        desde: this.pagina() * POR_PAGINA,
      };
      // Espera a que se deje de escribir antes de buscar.
      if (this.espera) clearTimeout(this.espera);
      this.espera = setTimeout(() => this.cargar(filtro), this.q() ? 250 : 0);
    });
  }

  protected filtrar(campo: 'q' | 'estado' | 'adscripcion', valor: string): void {
    this[campo].set(valor);
    this.pagina.set(0);
  }

  protected abrir(e: EmpleadoResumen): void {
    void this.router.navigate(['/empleados', e.id]);
  }

  private cargar(filtro: Parameters<ApiService['empleados']>[0]): void {
    this.cargando.set(true);
    this.api.empleados(filtro).subscribe({
      next: (r) => {
        this.empleados.set(r.empleados);
        this.total.set(r.total);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }
}
