import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Observable } from 'rxjs';
import { ApiService, mensajeDeError } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { AvisosService } from '../../../core/services/avisos.service';
import { ContextoService } from '../../../core/services/contexto.service';
import { NOMBRE_CALCULO, type FichaEmpleado, type OrigenClave, type QuincenaEmpleado } from '../../../core/services/modelos';
import { BuscarClave } from '../../../shared/buscar-clave/buscar-clave';
import { Cajon } from '../../../shared/cajon/cajon';
import { FORMATO } from '../../../shared/formato';
import { Icono } from '../../../shared/icono/icono';
import { MarcasClave } from '../../../shared/marcas-clave/marcas-clave';
import { Recibo } from '../../../shared/recibo/recibo';

type Pestana = 'general' | 'conceptos' | 'descuentos' | 'cuentas' | 'movimientos' | 'recibos' | 'personales';
type Cajones = 'marcas' | 'editar' | 'descuento' | 'baja' | 'permiso' | 'reingreso' | 'curp' | 'recibo' | null;

const NOMBRE_MOVIMIENTO: Record<string, string> = {
  alta: 'Alta',
  baja: 'Baja',
  permiso: 'Permiso',
  reingreso: 'Reingreso',
  cambio: 'Cambio',
};

@Component({
  selector: 'app-ficha-empleado',
  imports: [FormsModule, RouterLink, Icono, BuscarClave, Cajon, MarcasClave, Recibo, ...FORMATO],
  templateUrl: './ficha.html',
  styleUrl: './ficha.scss',
})
export class FichaEmpleadoPagina {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);

  readonly id = input.required<string>();

  protected readonly ficha = signal<FichaEmpleado | null>(null);
  protected readonly quincena = signal<QuincenaEmpleado | null>(null);
  protected readonly nombresOrigen: Record<OrigenClave, string> = {
    calculado: 'Lo calcula el sistema',
    fija: 'Fija',
    plazo: 'A plazo',
    captura: 'Capturada en la quincena',
  };
  protected readonly pestana = signal<Pestana>('general');
  protected readonly cajon = signal<Cajones>(null);
  protected readonly guardando = signal(false);
  protected readonly reciboId = signal<number | null>(null);
  protected readonly nombresCalculo = NOMBRE_CALCULO;
  protected readonly nombresMovimiento = NOMBRE_MOVIMIENTO;

  protected readonly puede = computed(() => !!this.auth.currentUser()?.capacidades.capturar);
  /** Claves de la nómina del empleado (no de la elegida arriba: puede estar viendo a alguien de otra). */
  protected readonly conceptos = computed(() => {
    const tipo = this.ficha()?.tipoNomina;
    return (this.contexto.opciones()?.conceptos ?? []).filter((c) => c.tipoNomina === tipo && !c.calculado);
  });
  protected readonly deducciones = computed(() => this.conceptos().filter((c) => c.naturaleza === 'D'));
  protected readonly motivos = computed(() => this.contexto.opciones()?.motivos ?? []);
  protected readonly sueldoQuincenal = computed(() => {
    const t = this.ficha()?.tabulador;
    return t ? (t.sueldoMensual + t.compensacionMensual + t.gratificacionMensual) / 2 : null;
  });

  protected readonly pestanas: { clave: Pestana; titulo: string }[] = [
    { clave: 'general', titulo: 'General' },
    { clave: 'conceptos', titulo: 'Percepciones y deducciones' },
    { clave: 'descuentos', titulo: 'Descuentos a plazo' },
    { clave: 'cuentas', titulo: 'Cuentas' },
    { clave: 'movimientos', titulo: 'Movimientos' },
    { clave: 'recibos', titulo: 'Recibos' },
    { clave: 'personales', titulo: 'Datos personales' },
  ];

  // Formularios
  protected edicion: Record<string, unknown> = {};
  protected nuevoFijo = this.movimientoVacio();
  protected nuevaCaptura = this.movimientoVacio();
  protected marcasFijo: { conceptoId: number; nombre: string; importe: number; gravaIsr: boolean | null; timbra: boolean | null } | null = null;
  protected descuento: { id?: number; conceptoId: number | null; importeQuincenal: number; porcentaje: number | null; quincenasPendientes: number | null; beneficiario: string; activo: boolean } = this.descuentoVacio();
  protected nuevaCuenta = { conceptoId: null as number | null, partida: '' };
  protected sucursal = { sucursal: null as number | null, tipo: 'E' };
  protected movimiento = { fecha: '', inicio: '', fin: '', motivoClave: '', observaciones: '' };
  protected nuevaCurp = '';

  constructor() {
    effect(() => this.cargar(Number(this.id())));
  }

  protected cargar(id: number): void {
    this.api.empleado(id).subscribe((f) => {
      this.ficha.set(f);
      this.sucursal = { sucursal: f.sucursal?.sucursal ?? null, tipo: f.sucursal?.tipo ?? 'E' };
    });
    this.api.quincenaEmpleado(id).subscribe({ next: (q) => this.quincena.set(q), error: () => this.quincena.set(null) });
  }

  // --- Datos generales ---
  protected abrirEdicion(): void {
    const f = this.ficha()!;
    this.edicion = {
      rfc: f.rfc,
      apellidoPaterno: f.apellidoPaterno,
      apellidoMaterno: f.apellidoMaterno ?? '',
      nombres: f.nombres,
      adscripcionId: f.adscripcionId,
      puestoClave: f.puestoClave,
      nivel: f.nivel,
      rango: f.rango,
      numeroIssemym: f.numeroIssemym,
      sindicalizado: f.sindicalizado,
      sci: f.sci,
      fechaNacimiento: f.fechaNacimiento ?? '',
      fechaIngresoGobierno: f.fechaIngresoGobierno ?? '',
      codigoPostalFiscal: f.codigoPostalFiscal ?? '',
      banco: f.banco ?? '',
      cuentaBancaria: f.cuentaBancaria ?? '',
      pagoCheque: f.pagoCheque,
      datosPersonales: { ...(f.datosPersonales ?? {}) },
    };
    this.cajon.set('editar');
  }

  protected guardarEdicion(): void {
    const limpio = Object.fromEntries(
      Object.entries(this.edicion).map(([k, v]) => [k, v === '' ? null : v]),
    );
    this.ejecutar(this.api.actualizarEmpleado(this.ficha()!.id, limpio), 'Cambios guardados.');
  }

  // --- Conceptos fijos ---
  protected agregarFijo(): void {
    const { conceptoId, importe, gravaIsr, timbra } = this.nuevoFijo;
    if (!conceptoId || !importe) return;
    this.ejecutar(this.api.fijarConcepto(this.ficha()!.id, conceptoId, { importe, gravaIsr, timbra }), 'Concepto asignado.', () => {
      this.nuevoFijo = this.movimientoVacio();
    });
  }

  /** Solo para la quincena abierta de su nómina. */
  protected capturar(): void {
    const p = this.quincena()?.periodo.id;
    const { conceptoId, importe, gravaIsr, timbra } = this.nuevaCaptura;
    if (!p || !conceptoId || !importe) return;
    this.ejecutar(this.api.capturar(p, { empleadoId: this.ficha()!.id, conceptoId, importe, gravaIsr, timbra }), 'Capturado en la quincena. Vuelve a calcular para que se refleje en el recibo.', () => {
      this.nuevaCaptura = this.movimientoVacio();
    });
  }

  protected clave(id: number | null) {
    return this.conceptos().find((c) => c.id === id) ?? null;
  }

  protected abrirMarcas(c: FichaEmpleado['fijos'][number]): void {
    this.marcasFijo = { conceptoId: c.concepto.id, nombre: c.concepto.nombre, importe: c.importe, gravaIsr: c.gravaIsr, timbra: c.timbra };
    this.cajon.set('marcas');
  }

  protected guardarMarcas(): void {
    const m = this.marcasFijo;
    if (m) this.ejecutar(this.api.fijarConcepto(this.ficha()!.id, m.conceptoId, { importe: m.importe, gravaIsr: m.gravaIsr, timbra: m.timbra }), 'Guardado.');
  }

  private movimientoVacio() {
    return { conceptoId: null as number | null, importe: null as number | null, gravaIsr: null as boolean | null, timbra: null as boolean | null };
  }

  protected cambiarFijo(conceptoId: number, valor: string, anterior: number): void {
    const importe = Number(valor);
    if (!Number.isFinite(importe) || importe === anterior) return;
    this.ejecutar(this.api.fijarConcepto(this.ficha()!.id, conceptoId, { importe }), 'Importe actualizado.');
  }

  protected async quitarFijo(conceptoId: number, nombre: string): Promise<void> {
    if (!(await this.avisos.confirmar({ titulo: 'Quitar concepto', texto: `Ya no se aplicará ${nombre} en las siguientes quincenas.`, accion: 'Quitar', peligro: true }))) return;
    this.ejecutar(this.api.quitarConcepto(this.ficha()!.id, conceptoId), 'Concepto retirado.');
  }

  // --- Descuentos a plazo ---
  protected abrirDescuento(d?: FichaEmpleado['descuentosPlazo'][number]): void {
    this.descuento = d
      ? { id: d.id, conceptoId: d.concepto.id, importeQuincenal: d.importeQuincenal, porcentaje: d.porcentaje, quincenasPendientes: d.quincenasPendientes, beneficiario: d.beneficiario ?? '', activo: d.activo }
      : this.descuentoVacio();
    this.cajon.set('descuento');
  }

  protected guardarDescuento(): void {
    const { id, ...datos } = this.descuento;
    this.ejecutar(this.api.guardarDescuento(this.ficha()!.id, { ...datos, beneficiario: datos.beneficiario || null }, id), 'Descuento guardado.');
  }

  protected async quitarDescuento(id: number): Promise<void> {
    if (!(await this.avisos.confirmar({ titulo: 'Eliminar descuento', texto: 'Se deja de aplicar desde la siguiente quincena que se calcule.', accion: 'Eliminar', peligro: true }))) return;
    this.ejecutar(this.api.quitarDescuento(this.ficha()!.id, id), 'Descuento eliminado.');
  }

  // --- Cuentas ---
  protected guardarCuenta(): void {
    const { conceptoId, partida } = this.nuevaCuenta;
    if (!conceptoId || !partida) return;
    this.ejecutar(this.api.guardarCuentaContable(this.ficha()!.id, conceptoId, partida), 'Cuenta contable guardada.', () => {
      this.nuevaCuenta = { conceptoId: null, partida: '' };
    });
  }

  protected quitarCuenta(id: number): void {
    this.ejecutar(this.api.quitarCuentaContable(this.ficha()!.id, id), 'Cuenta contable eliminada.');
  }

  protected guardarSucursal(): void {
    this.ejecutar(this.api.guardarSucursal(this.ficha()!.id, this.sucursal.sucursal, this.sucursal.tipo), 'Sucursal guardada.');
  }

  // --- Movimientos ---
  protected abrirMovimiento(tipo: 'baja' | 'permiso' | 'reingreso'): void {
    const hoy = new Date().toISOString().slice(0, 10);
    this.movimiento = { fecha: hoy, inicio: hoy, fin: '', motivoClave: '', observaciones: '' };
    this.cajon.set(tipo);
  }

  protected guardarMovimiento(tipo: 'baja' | 'permiso' | 'reingreso'): void {
    const m = this.movimiento;
    const datos =
      tipo === 'permiso'
        ? { inicio: m.inicio, fin: m.fin || null, motivoClave: m.motivoClave, observaciones: m.observaciones || undefined }
        : tipo === 'baja'
          ? { fecha: m.fecha, motivoClave: m.motivoClave, observaciones: m.observaciones || undefined }
          : { fecha: m.fecha, observaciones: m.observaciones || undefined };
    const texto = { baja: 'Baja registrada.', permiso: 'Permiso registrado.', reingreso: 'Reingreso registrado.' }[tipo];
    this.ejecutar(this.api.movimiento(this.ficha()!.id, tipo, datos), texto, () => this.contexto.recargarPeriodo());
  }

  protected async cancelarMovimiento(id: number, tipo: string): Promise<void> {
    if (!(await this.avisos.confirmar({ titulo: `Cancelar ${tipo}`, texto: 'El empleado regresa al estado que tenía antes de este movimiento.', accion: `Cancelar ${tipo}`, peligro: true }))) return;
    this.ejecutar(this.api.cancelarMovimiento(id), 'Movimiento cancelado.');
  }

  protected guardarCurp(): void {
    this.ejecutar(this.api.cambiarCurp(this.ficha()!.id, this.nuevaCurp.trim().toUpperCase()), 'CURP actualizada.');
  }

  protected verRecibo(id: number): void {
    this.reciboId.set(id);
    this.cajon.set('recibo');
  }

  protected detalle(d: Record<string, unknown> | null): string {
    if (!d) return '';
    return Object.entries(d)
      .map(([k, v]) => {
        const cambio = v as { antes?: unknown; despues?: unknown } | null;
        return cambio && typeof cambio === 'object' && 'antes' in cambio ? `${k}: ${cambio.antes} → ${cambio.despues}` : `${k}: ${v}`;
      })
      .join(' · ');
  }

  private descuentoVacio() {
    return { conceptoId: null, importeQuincenal: 0, porcentaje: null, quincenasPendientes: null, beneficiario: '', activo: true };
  }

  /** Guarda, avisa, recarga la ficha y cierra el cajón. */
  private ejecutar(peticion: Observable<unknown>, exito: string, despues?: () => void): void {
    this.guardando.set(true);
    peticion.subscribe({
      next: () => {
        this.avisos.exito(exito);
        this.guardando.set(false);
        this.cajon.set(null);
        despues?.();
        this.cargar(this.ficha()!.id);
      },
      error: (e) => {
        this.avisos.error(mensajeDeError(e));
        this.guardando.set(false);
      },
    });
  }
}
