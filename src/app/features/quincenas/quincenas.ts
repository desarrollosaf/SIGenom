import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import { NOMBRE_CALCULO, NOMBRE_ESTADO_PERIODO, type Periodo, type PeriodoDetalle } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';

/**
 * Las quincenas de la nómina: abrir, cerrar y consultar las anteriores. Sustituye a los respaldos
 * (RESP.W, RESP-V.W…), a "Recuperar nómina" (BOR-CAR-EP.W) y a la consulta de quincenas anteriores
 * (res-qnas): aquí nada se borra al cerrar, así que no hay que respaldar ni recuperar.
 */
@Component({
  selector: 'app-quincenas',
  imports: [FormsModule, RouterLink, Icono, ...FORMATO],
  template: `
    <div class="pagina">
      <header class="encabezado">
        <div>
          <p class="antetitulo">Quincena · {{ contexto.nombreNomina() }}</p>
          <h1 class="titulo">Quincenas</h1>
          <p class="apagado">Siempre hay una sola quincena en curso por nómina. Al cerrarla queda guardada tal cual y se abre la siguiente sola. Ya no hay respaldos ni recuperaciones.</p>
        </div>
        @if (puedeAbrir() && !contexto.abierto() && !contexto.cargando()) {
          <button type="button" class="boton" (click)="abriendo.set(!abriendo())"><app-icono nombre="mas" [tamano]="16" />Abrir quincena</button>
        }
      </header>

      @if (abriendo() && !contexto.abierto()) {
        <section class="tarjeta con-relleno" style="margin-bottom: 16px">
          <div class="acciones">
            <label class="chico apagado">Año <input class="campo cifra" type="number" style="width: 100px" [(ngModel)]="nueva.anio" /></label>
            <label class="chico apagado">Quincena <input class="campo cifra" type="number" min="1" max="24" style="width: 90px" [(ngModel)]="nueva.quincena" /></label>
            <button type="button" class="boton primario" (click)="abrir()">Abrir</button>
            <span class="tenue chico">Las fechas se calculan solas: la impar del 1 al 15, la par del 16 al fin de mes.</span>
          </div>
        </section>
      }

      @if (detalle(); as d) {
        @if (d.estado !== 'cerrado') {
          <section class="tarjeta con-relleno actual">
            <div class="cabeza-seccion">
              <div>
                <p class="antetitulo">En curso</p>
                <h2 class="titulo-medio">{{ d.nombre }}</h2>
                <p class="apagado chico">Del {{ d.fechaInicio | fecha }} al {{ d.fechaFin | fecha }} · {{ d.capturas }} capturas · {{ estados[d.estado] }}</p>
              </div>
              <div class="acciones">
                <label class="chico apagado">Fecha de pago <input class="campo" type="date" [ngModel]="d.fechaPago" (change)="cambiarPago(d.id, $any($event.target).value)" [disabled]="!puedeAbrir()" /></label>
                @if (puedeCerrar()) {
                  <button type="button" class="boton primario" [disabled]="!nominaLista()" [title]="nominaLista() ? '' : 'Primero calcula la nómina definitiva'" (click)="cerrar(d)">
                    <app-icono nombre="candado" [tamano]="15" />Cerrar quincena
                  </button>
                }
              </div>
            </div>
            @if (!nominaLista()) {
              <div class="nota chico" style="margin-top: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap">
                <span>Esta quincena sigue en proceso. Calcúlala, revísala y ciérrala paso a paso desde Proceso de nómina.</span>
                <a class="boton chico primario" routerLink="/proceso">Ir al proceso</a>
              </div>
            }
          </section>
        }
      }

      <section class="seccion">
        <h2 class="titulo-chico">Historial</h2>
        <div class="tabla-marco">
          <table class="tabla">
            <thead><tr><th>Quincena</th><th>Periodo</th><th>Pago</th><th>Estado</th><th>Cerró</th></tr></thead>
            <tbody>
              @for (p of periodos(); track p.id) {
                <tr>
                  <td><span class="principal">{{ p.nombre }}</span><span class="sub">Q{{ p.quincena.toString().padStart(2, '0') }}/{{ p.anio }}</span></td>
                  <td class="chico">{{ p.fechaInicio | fecha }} – {{ p.fechaFin | fecha }}</td>
                  <td class="chico">{{ p.fechaPago | fecha }}</td>
                  <td><span class="insignia" [class.verde]="p.estado === 'cerrado'" [class.ambar]="p.estado === 'captura'" [class.azul]="p.estado === 'prenomina' || p.estado === 'nomina'">{{ estados[p.estado] }}</span></td>
                  <td class="chico tenue">{{ p.cerradoPor ?? '' }} {{ p.cerradoEl ? (p.cerradoEl | fecha: true) : '' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="5"><div class="vacio"><p class="titulo-chico">Sin quincenas</p><p>Abre la primera para empezar.</p></div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
  styles: `
    .actual {
      border-color: var(--acento);
    }
  `,
})
export class Quincenas {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);

  protected readonly periodos = signal<Periodo[]>([]);
  protected readonly detalle = signal<PeriodoDetalle | null>(null);
  protected readonly abriendo = signal(false);
  protected readonly estados = NOMBRE_ESTADO_PERIODO;
  protected readonly nombres = NOMBRE_CALCULO;
  protected readonly puedeAbrir = computed(() => !!this.auth.currentUser()?.capacidades.calcular);
  protected readonly puedeCerrar = computed(() => !!this.auth.currentUser()?.capacidades.cerrar);
  protected readonly nominaLista = computed(() => !!this.detalle()?.calculos.some((c) => c.tipo === 'nomina' && c.estado === 'terminado'));

  protected nueva = { anio: new Date().getFullYear(), quincena: new Date().getMonth() * 2 + (new Date().getDate() <= 15 ? 1 : 2) };

  constructor() {
    effect(() => {
      const tipo = this.contexto.tipoNomina();
      const actual = this.contexto.periodo();
      this.api.periodos(tipo).subscribe((l) => this.periodos.set(l));
      if (actual) this.api.periodo(actual.id).subscribe((d) => this.detalle.set(d));
      else this.detalle.set(null);
    });
  }

  protected abrir(): void {
    this.api.abrirPeriodo({ tipoNomina: this.contexto.tipoNomina(), ...this.nueva }).subscribe({
      next: () => {
        this.avisos.exito('Quincena abierta.');
        this.abriendo.set(false);
        this.contexto.recargarPeriodo();
      },
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }

  protected cambiarPago(id: number, fecha: string): void {
    this.api.fechaPago(id, fecha).subscribe({
      next: () => this.avisos.exito('Fecha de pago actualizada.'),
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }

  protected async cerrar(p: PeriodoDetalle): Promise<void> {
    const ok = await this.avisos.confirmar({
      titulo: `Cerrar ${p.nombre}`,
      texto: 'Ya no se podrá capturar ni recalcular. Se descuenta una quincena a los descuentos a plazo y se abre la siguiente.',
      accion: 'Cerrar quincena',
    });
    if (!ok) return;
    this.api.cerrarPeriodo(p.id).subscribe({
      next: () => {
        this.avisos.exito('Quincena cerrada. Ya está abierta la siguiente.');
        this.contexto.recargarPeriodo();
      },
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }
}
