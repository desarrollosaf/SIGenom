import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { MovimientoLista } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';

/** Altas, bajas, permisos, reingresos y cambios. Reúne 1CANC-BA, 1CANC-PE, 1VERI-PERM y la consulta de permisos. */
@Component({
  selector: 'app-movimientos',
  imports: [FormsModule, RouterLink, ...FORMATO],
  template: `
    <div class="pagina">
      <header class="encabezado">
        <div>
          <p class="antetitulo">Personal · {{ contexto.nombreNomina() }}</p>
          <h1 class="titulo">Movimientos de personal</h1>
          <p class="apagado">Para registrar uno nuevo, abre la ficha del empleado.</p>
        </div>
      </header>

      <div class="barra-filtros">
        <div class="pestanas" style="margin: 0; border: 0">
          @for (t of tipos; track t.valor) {
            <button type="button" [class.activa]="tipo() === t.valor" (click)="tipo.set(t.valor)">{{ t.etiqueta }}</button>
          }
        </div>
        <span style="flex: 1"></span>
        <label class="chico apagado">Desde <input class="campo" type="date" [ngModel]="desde()" (ngModelChange)="desde.set($event)" /></label>
        <label class="chico apagado">Hasta <input class="campo" type="date" [ngModel]="hasta()" (ngModelChange)="hasta.set($event)" /></label>
      </div>

      <div class="tabla-marco">
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Movimiento</th><th>Empleado</th><th>Motivo</th><th>Registró</th><th class="min"></th></tr></thead>
          <tbody>
            @for (m of lista(); track m.id) {
              <tr [style.opacity]="m.cancelado ? 0.55 : 1">
                <td class="mono">{{ m.fechaInicio | fecha }}@if (m.fechaFin) {<span class="sub">hasta {{ m.fechaFin | fecha }}</span>}</td>
                <td>
                  <span class="insignia" [class.verde]="m.tipo === 'alta' || m.tipo === 'reingreso'" [class.rojo]="m.tipo === 'baja'" [class.ambar]="m.tipo === 'permiso'" [class.azul]="m.tipo === 'cambio'">{{ m.tipo }}</span>
                  @if (m.cancelado) {<span class="sub">cancelado</span>}
                </td>
                <td><a [routerLink]="['/empleados', m.empleadoId]" class="principal" style="text-decoration: none">{{ m.nombre }}</a><span class="sub">{{ m.curp }}</span></td>
                <td>{{ m.motivo ?? '—' }}@if (m.observaciones) {<span class="sub" style="font-family: var(--sans)">{{ m.observaciones }}</span>}</td>
                <td class="mono tenue">{{ m.registradoPor }}</td>
                <td>
                  @if (puede && !m.cancelado && (m.tipo === 'baja' || m.tipo === 'permiso')) {
                    <button type="button" class="boton chico peligro" (click)="cancelar(m)">Cancelar</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6"><div class="vacio"><p class="titulo-chico">Sin movimientos</p><p>No hay movimientos con estos filtros.</p></div></td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class Movimientos {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly contexto = inject(ContextoService);
  protected readonly puede = !!inject(AuthService).currentUser()?.capacidades.capturar;

  protected readonly tipos = [
    { valor: '', etiqueta: 'Todos' },
    { valor: 'alta', etiqueta: 'Altas' },
    { valor: 'baja', etiqueta: 'Bajas' },
    { valor: 'permiso', etiqueta: 'Permisos' },
    { valor: 'reingreso', etiqueta: 'Reingresos' },
    { valor: 'cambio', etiqueta: 'Cambios' },
  ];
  protected readonly tipo = signal('');
  protected readonly desde = signal(`${new Date().getFullYear()}-01-01`);
  protected readonly hasta = signal('');
  protected readonly lista = signal<MovimientoLista[]>([]);

  constructor() {
    effect(() => this.cargar());
  }

  private cargar(): void {
    this.api
      .movimientos({ tipo: this.tipo(), desde: this.desde(), hasta: this.hasta(), tipoNomina: this.contexto.tipoNomina() })
      .subscribe((l) => this.lista.set(l));
  }

  protected async cancelar(m: MovimientoLista): Promise<void> {
    const ok = await this.avisos.confirmar({
      titulo: `Cancelar ${m.tipo}`,
      texto: `${m.nombre} regresa al estado que tenía antes de este movimiento.`,
      accion: `Cancelar ${m.tipo}`,
      peligro: true,
    });
    if (!ok) return;
    this.api.cancelarMovimiento(m.id).subscribe({
      next: () => {
        this.avisos.exito('Movimiento cancelado.');
        this.cargar();
      },
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }
}
