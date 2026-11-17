import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import { guardarArchivo } from '../../core/services/descarga';
import {
  NOMBRE_CALCULO,
  type Calculo,
  type ColumnaReporte,
  type DefinicionReporte,
  type Periodo,
  type TablaReporte,
} from '../../core/services/modelos';
import { FORMATO, MonedaPipe, NumeroPipe } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/** Todos los reportes del sistema anterior con un solo visor: se elige, se filtra, se ve y se baja a Excel. */
@Component({
  selector: 'app-reportes',
  imports: [FormsModule, Icono, ...FORMATO],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
})
export class Reportes {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly contexto = inject(ContextoService);
  private readonly moneda = new MonedaPipe();
  private readonly numero = new NumeroPipe();

  protected readonly catalogo = signal<DefinicionReporte[]>([]);
  protected readonly elegido = signal<DefinicionReporte | null>(null);
  protected readonly periodos = signal<Periodo[]>([]);
  protected readonly calculos = signal<Calculo[]>([]);
  protected readonly tabla = signal<TablaReporte | null>(null);
  protected readonly cargando = signal(false);
  protected readonly meses = MESES;
  protected readonly nombres = NOMBRE_CALCULO;

  protected periodoId: number | null = null;
  protected calculoId: number | null = null;
  protected anio = new Date().getFullYear();
  protected mes = new Date().getMonth() + 1;
  protected orden = '';

  protected readonly grupos = computed(() => {
    const mapa = new Map<string, DefinicionReporte[]>();
    for (const r of this.catalogo()) mapa.set(r.grupo, [...(mapa.get(r.grupo) ?? []), r]);
    return [...mapa.entries()].map(([titulo, reportes]) => ({ titulo, reportes }));
  });

  constructor() {
    this.api.reportes().subscribe((c) => this.catalogo.set(c));
    effect(() => {
      const tipo = this.contexto.tipoNomina();
      this.api.periodos(tipo).subscribe((l) => {
        this.periodos.set(l);
        // La más reciente que ya tenga algo calculado; si ninguna, la más reciente.
        this.periodoId = (l.find((p) => p.estado !== 'captura') ?? l[0])?.id ?? null;
        if (this.periodoId) this.cargarCalculos();
      });
    });
  }

  protected elegir(r: DefinicionReporte): void {
    this.elegido.set(r);
    this.tabla.set(null);
    this.orden = r.ordenes?.[0]?.valor ?? '';
  }

  protected cargarCalculos(): void {
    if (!this.periodoId) return;
    this.api.periodo(this.periodoId).subscribe((p) => {
      const terminados = p.calculos.filter((c) => c.estado === 'terminado');
      this.calculos.set(terminados);
      this.calculoId = (terminados.find((c) => c.tipo === 'nomina') ?? terminados[0])?.id ?? null;
    });
  }

  private filtros(): Record<string, string | number | undefined> {
    const r = this.elegido()!;
    return {
      calculoId: r.filtro === 'calculo' ? (this.calculoId ?? undefined) : undefined,
      tipoNomina: this.contexto.tipoNomina(),
      anio: r.filtro === 'mes' || r.filtro === 'anio' ? this.anio : undefined,
      mes: r.filtro === 'mes' ? this.mes : undefined,
      orden: this.orden || undefined,
    };
  }

  protected ejecutar(): void {
    const r = this.elegido();
    if (!r) return;
    this.cargando.set(true);
    this.api.reporte(r.clave, this.filtros()).subscribe({
      next: (t) => {
        this.tabla.set(t);
        this.cargando.set(false);
      },
      error: (e) => {
        this.cargando.set(false);
        this.avisos.error(mensajeDeError(e));
      },
    });
  }

  protected excel(): void {
    const r = this.elegido();
    if (!r) return;
    this.api.archivo(`reportes/${r.clave}/excel`, this.filtros()).subscribe((blob) => guardarArchivo(blob, `${r.clave}.xlsx`));
  }

  protected imprimir(): void {
    window.print();
  }

  protected valor(columna: ColumnaReporte, fila: Record<string, unknown>): string {
    const v = fila[columna.clave];
    if (v === null || v === undefined || v === '') return columna.tipo === 'dinero' ? this.moneda.transform(0) : '';
    if (columna.tipo === 'dinero') return this.moneda.transform(Number(v));
    if (columna.tipo === 'numero') return this.numero.transform(Number(v));
    return String(v);
  }

  protected total(columna: ColumnaReporte): string {
    const t = this.tabla()?.totales?.[columna.clave];
    if (t === undefined) return '';
    return columna.tipo === 'dinero' ? this.moneda.transform(t) : this.numero.transform(t);
  }
}
