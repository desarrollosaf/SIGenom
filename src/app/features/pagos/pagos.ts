import { Component, computed, effect, inject, signal, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';
import { ContextoService } from '../../core/services/contexto.service';
import { guardarArchivo } from '../../core/services/descarga';
import { NOMBRE_CALCULO, type Calculo, type ResumenDispersion } from '../../core/services/modelos';
import { FORMATO } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';

/** Dispersión al banco (1TRA-BAN, 1TRA-CLABE), cheques (1REP-CHE, 1LIS-CHE) y comprobantes (1COM-PAG). */
@Component({
  selector: 'app-pagos',
  imports: [FormsModule, RouterLink, Icono, ...FORMATO],
  templateUrl: './pagos.html',
  styles: `
    .documentos {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }
    .documentos .boton {
      justify-content: flex-start;
    }
    .siguiente {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px 24px;
      border-color: var(--acento);
      background: var(--acento-suave);
    }
    .siguiente > div {
      flex: 1 1 320px;
    }
  `,
})
export class Pagos {
  /** Dentro del asistente de Proceso de nómina: sin encabezado de página. */
  readonly incrustado = input(false);
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);

  protected readonly calculos = signal<Calculo[]>([]);
  protected readonly calculoId = signal<number | null>(null);
  protected readonly resumen = signal<ResumenDispersion | null>(null);
  protected readonly nombres = NOMBRE_CALCULO;
  protected readonly puede = computed(() => !!this.auth.currentUser()?.capacidades.calcular);
  protected readonly puedeCerrar = computed(() => !!this.auth.currentUser()?.capacidades.cerrar);
  /** Si ya se capturaron en Parámetros los datos del contrato con Citibanamex. */
  protected readonly contratoBanamex = signal(true);

  protected layout = 'citibanamex';
  protected fecha = '';
  protected secuencia = 1;

  constructor() {
    // Sin contrato capturado, el layout de Citibanamex no se puede generar: se propone el CSV.
    this.api.catalogo('parametros').subscribe((filas) => {
      const valor = (clave: string) => String(filas.find((f) => f['clave'] === clave)?.['valor'] ?? '').trim();
      const completo = ['banamex_cliente', 'banamex_sucursal_cargo', 'banamex_cuenta_cargo'].every((c) => valor(c));
      this.contratoBanamex.set(completo);
      if (!completo) this.layout = 'csv';
    });
    effect(() => {
      const p = this.contexto.periodo();
      this.resumen.set(null);
      if (!p) return;
      this.fecha = p.fechaPago ?? p.fechaFin;
      this.api.periodo(p.id).subscribe((d) => {
        const pagables = d.calculos.filter((c) => c.estado === 'terminado' && c.tipo !== 'prenomina');
        this.calculos.set(pagables);
        this.calculoId.set(pagables[0]?.id ?? null);
      });
    });
    effect(() => {
      const id = this.calculoId();
      if (id) this.api.dispersion(id).subscribe((r) => this.resumen.set(r));
    });
  }

  protected descargar(): void {
    const id = this.calculoId();
    if (!id) return;
    this.api.archivo(`calculos/${id}/dispersion/archivo`, { layout: this.layout, fecha: this.fecha, secuencia: this.secuencia }).subscribe({
      next: (blob) => {
        const extension = this.layout === 'csv' ? 'csv' : 'txt';
        const p = this.contexto.periodo()!;
        guardarArchivo(blob, `dispersion-${p.tipoNomina}-${p.anio}-q${p.quincena}-${this.secuencia}.${extension}`);
        this.avisos.exito('Archivo de dispersión generado.');
      },
      // El error llega como Blob: hay que leerlo para mostrar el mensaje.
      error: async (e) => {
        try {
          const texto = await (e.error as Blob).text();
          this.avisos.error(JSON.parse(texto).message);
        } catch {
          this.avisos.error(mensajeDeError(e));
        }
      },
    });
  }

  protected reporte(clave: 'depositos' | 'cheques' | 'firmas'): void {
    const id = this.calculoId();
    if (!id) return;
    this.api.archivo(`reportes/${clave}/excel`, { calculoId: id }).subscribe((blob) => guardarArchivo(blob, `${clave}.xlsx`));
  }

  protected comprobantes(): void {
    const id = this.calculoId();
    if (!id) return;
    this.avisos.exito('Generando los comprobantes en PDF…');
    this.api.archivo(`calculos/${id}/recibos.pdf`).subscribe((blob) => guardarArchivo(blob, `comprobantes-${id}.pdf`));
  }
}
