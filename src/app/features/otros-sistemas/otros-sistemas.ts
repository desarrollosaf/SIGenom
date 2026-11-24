import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import type { EstadoExterno, MovimientoExterno, SistemaExterno } from '../../core/services/modelos';
import { Cajon } from '../../shared/cajon/cajon';
import { FORMATO } from '../../shared/formato';
import { Icono, type NombreIcono } from '../../shared/icono/icono';

const ICONO: Record<SistemaExterno['clave'], NombreIcono> = { personal: 'personas', checador: 'bitacora', prestamos: 'banco' };
const POR_PAGINA = 100;

/**
 * Bandeja de lo que mandan Personal, Checadores y Préstamos. Se trae, se revisa qué va a cambiar y se
 * aplica o se descarta. Sustituye a los traspasos por archivo (1TRA-I-P, 1TRA-REI…).
 */
@Component({
  selector: 'app-otros-sistemas',
  imports: [FormsModule, RouterLink, Icono, Cajon, ...FORMATO],
  templateUrl: './otros-sistemas.html',
  styleUrl: './otros-sistemas.scss',
})
export class OtrosSistemas {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly contexto = inject(ContextoService);
  protected readonly puede = !!inject(AuthService).currentUser()?.capacidades.capturar;

  protected readonly sistemas = signal<SistemaExterno[]>([]);
  protected readonly elegido = signal<SistemaExterno['clave']>('personal');
  protected readonly estado = signal<EstadoExterno>('pendiente');
  protected readonly tipo = signal('');
  protected readonly q = signal('');
  protected readonly desde = signal(0);
  protected readonly lista = signal<MovimientoExterno[]>([]);
  protected readonly total = signal(0);
  protected readonly porTipo = signal<Record<string, number>>({});
  protected readonly cargando = signal(false);
  protected readonly trayendo = signal(false);
  protected readonly ocupado = signal(false);
  protected readonly marcados = signal<Set<number>>(new Set());
  protected readonly abierto = signal<MovimientoExterno | null>(null);
  protected readonly descartando = signal<number[] | null>(null);
  protected motivo = '';
  protected quitarSeleccion(): void {
    this.marcados.set(new Set());
  }
  private readonly vuelta = signal(0);

  protected readonly icono = ICONO;
  protected readonly porPagina = POR_PAGINA;
  protected readonly estados: { valor: EstadoExterno; etiqueta: string }[] = [
    { valor: 'pendiente', etiqueta: 'Por aplicar' },
    { valor: 'aplicado', etiqueta: 'Aplicados' },
    { valor: 'descartado', etiqueta: 'Descartados' },
  ];

  protected readonly sistema = computed(() => this.sistemas().find((s) => s.clave === this.elegido()) ?? null);
  protected readonly tipos = computed(() => Object.entries(this.sistema()?.tipos ?? {}).filter(([t]) => this.porTipo()[t]).map(([valor, etiqueta]) => ({ valor, etiqueta, total: this.porTipo()[valor] })));
  protected readonly aplicables = computed(() => this.lista().filter((m) => m.estado === 'pendiente' && !m.problema));
  protected readonly todos = computed(() => this.aplicables().length > 0 && this.aplicables().every((m) => this.marcados().has(m.id)));

  constructor() {
    this.cargarSistemas();
    effect((limpiar) => {
      const s = this.elegido();
      const filtro = { estado: this.estado(), tipo: this.tipo(), q: this.q().trim(), desde: this.desde() };
      this.vuelta();
      this.cargando.set(true);
      let pedido: { unsubscribe(): void } | undefined;
      const espera = setTimeout(
        () => {
          pedido = this.api.movimientosExternos(s, filtro).subscribe({
            next: (r) => {
              this.lista.set(r.movimientos);
              this.total.set(r.total);
              this.porTipo.set(r.porTipo);
              this.cargando.set(false);
              untracked(() => this.marcados.update((m) => new Set([...m].filter((id) => r.movimientos.some((x) => x.id === id && x.estado === 'pendiente' && !x.problema)))));
            },
            error: (e) => {
              this.cargando.set(false);
              this.avisos.error(mensajeDeError(e));
            },
          });
        },
        filtro.q ? 300 : 0,
      );
      limpiar(() => {
        clearTimeout(espera);
        pedido?.unsubscribe();
      });
    });
  }

  protected elegir(s: SistemaExterno['clave']): void {
    if (s === this.elegido()) return;
    this.elegido.set(s);
    this.lista.set([]);
    this.porTipo.set({});
    this.q.set('');
    this.ir({ estado: 'pendiente' });
  }

  protected ir(cambio: { estado?: EstadoExterno; tipo?: string }): void {
    if (cambio.estado) {
      this.estado.set(cambio.estado);
      this.tipo.set('');
    }
    if (cambio.tipo !== undefined) this.tipo.set(cambio.tipo);
    this.desde.set(0);
    this.marcados.set(new Set());
  }

  protected traer(): void {
    const s = this.sistema();
    if (!s || this.trayendo()) return;
    this.trayendo.set(true);
    this.api.traerExternos(s.clave).subscribe({
      next: (r) => {
        this.trayendo.set(false);
        this.avisos.exito(r.nuevos ? `${r.nuevos} ${r.nuevos === 1 ? 'movimiento nuevo' : 'movimientos nuevos'} de ${s.nombre}.` : `No hay nada nuevo en ${s.nombre}.`);
        this.ir({ estado: 'pendiente' });
        this.recargar();
      },
      error: (e) => {
        this.trayendo.set(false);
        this.avisos.error(mensajeDeError(e));
        this.cargarSistemas();
      },
    });
  }

  protected alternar(m: MovimientoExterno): void {
    this.marcados.update((s) => {
      const n = new Set(s);
      if (!n.delete(m.id)) n.add(m.id);
      return n;
    });
  }

  protected alternarTodos(): void {
    this.marcados.set(this.todos() ? new Set() : new Set(this.aplicables().map((m) => m.id)));
  }

  protected async aplicar(ids: number[]): Promise<void> {
    if (!ids.length || this.ocupado()) return;
    if (ids.length > 1) {
      const dobles = this.lista().filter((m) => ids.includes(m.id) && m.avisos.some((a) => a.includes('dos veces'))).length;
      const ok = await this.avisos.confirmar({
        titulo: `Aplicar ${ids.length} movimientos`,
        texto: `Cambian la ficha o la quincena abierta de cada persona. Queda en la bitácora.${dobles ? ` Ojo: ${dobles} podrían duplicar algo que ya trae esta quincena.` : ''}`,
        accion: 'Aplicar',
      });
      if (!ok) return;
    }
    this.ocupado.set(true);
    this.api.aplicarExternos(this.elegido(), ids).subscribe({
      next: (r) => {
        this.ocupado.set(false);
        this.abierto.set(null);
        this.marcados.set(new Set());
        if (r.aplicados) this.avisos.exito(`${r.aplicados} ${r.aplicados === 1 ? 'aplicado' : 'aplicados'}. Vuelve a calcular la quincena si ya la calculaste.`);
        if (r.errores.length) this.avisos.error(r.errores.length === 1 ? `${r.errores[0].nombre}: ${r.errores[0].error}` : `${r.errores.length} no se pudieron aplicar; cada uno dice por qué.`);
        this.recargar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.avisos.error(mensajeDeError(e));
        this.recargar();
      },
    });
  }

  protected pedirDescarte(ids: number[]): void {
    this.motivo = '';
    this.abierto.set(null);
    this.descartando.set(ids);
  }

  protected descartar(): void {
    const ids = this.descartando();
    if (!ids || this.motivo.trim().length < 3) return;
    this.ocupado.set(true);
    this.api.descartarExternos(this.elegido(), ids, this.motivo.trim()).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.descartando.set(null);
        this.marcados.set(new Set());
        this.avisos.exito('Descartado. Si fue un error, lo regresas desde Descartados.');
        this.recargar();
      },
      error: (e) => {
        this.ocupado.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }

  protected restaurar(m: MovimientoExterno): void {
    this.api.restaurarExterno(this.elegido(), m.id).subscribe({
      next: () => {
        this.abierto.set(null);
        this.recargar();
      },
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }

  protected tono(m: MovimientoExterno): string {
    if (['A', 'reintegro', 'estimulo', 'alta', 'reanudacion'].includes(m.tipo)) return 'verde';
    if (['B', 'falta', 'retardo'].includes(m.tipo)) return 'rojo';
    if (['L', 'suspension', 'liquidacion'].includes(m.tipo)) return 'ambar';
    return 'azul';
  }

  private recargar(): void {
    this.vuelta.update((v) => v + 1);
    this.cargarSistemas();
  }

  private cargarSistemas(): void {
    this.api.sistemasExternos().subscribe({ next: (s) => this.sistemas.set(s), error: (e) => this.avisos.error(mensajeDeError(e)) });
  }
}
