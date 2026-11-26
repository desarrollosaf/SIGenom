import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  AjusteNeto,
  AjusteQuincena,
  Calculo,
  Captura,
  DatosMasiva,
  DefinicionCatalogo,
  DefinicionReporte,
  Diagnostico,
  EmpleadoResumen,
  FichaEmpleado,
  ImpactoMovimiento,
  MasivaHecha,
  MovimientoExterno,
  MovimientoLista,
  DatosAnalisis,
  QuincenaEmpleado,
  Opciones,
  Periodo,
  PeriodoDetalle,
  ReciboDetalle,
  ReciboFila,
  ReciboPrueba,
  RegistroBitacora,
  ResultadoSimulacion,
  ResultadoTablaRang,
  ResumenDispersion,
  SistemaExterno,
  TablaReporte,
  Tablero,
  TipoCalculo,
  UsuarioSistema,
  VistaMasiva,
  VistaRetroactivo,
} from './modelos';

/** Quita los filtros vacíos para no mandarlos en la URL. */
function sinVacios(filtro: object): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(filtro).filter(([, valor]) => valor !== undefined && valor !== null && valor !== ''),
  );
}

/** El mensaje que el backend mandó, listo para mostrarse. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'No hay conexión con el servidor. Intenta de nuevo.';
    const mensaje = error.error?.message;
    if (Array.isArray(mensaje)) return mensaje.join('. ');
    if (typeof mensaje === 'string') return mensaje;
  }
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}

/** Todas las llamadas a la API, en un solo lugar. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiUrl;

  // --- Tablero y catálogos ---
  tablero(tipoNomina: string): Observable<Tablero> {
    return this.http.get<Tablero>(`${this.url}/tablero`, { params: { tipoNomina } });
  }

  opciones(tipoNomina?: string): Observable<Opciones> {
    return this.http.get<Opciones>(`${this.url}/catalogos/opciones`, { params: sinVacios({ tipoNomina }) });
  }

  catalogos(): Observable<DefinicionCatalogo[]> {
    return this.http.get<DefinicionCatalogo[]>(`${this.url}/catalogos`);
  }

  catalogo(clave: string, tipoNomina?: string): Observable<Record<string, unknown>[]> {
    return this.http.get<Record<string, unknown>[]>(`${this.url}/catalogos/${clave}`, { params: sinVacios({ tipoNomina }) });
  }

  guardarRenglon(clave: string, datos: Record<string, unknown>, id?: string): Observable<unknown> {
    return id
      ? this.http.put(`${this.url}/catalogos/${clave}/${encodeURIComponent(id)}`, datos)
      : this.http.post(`${this.url}/catalogos/${clave}`, datos);
  }

  borrarRenglon(clave: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/catalogos/${clave}/${encodeURIComponent(id)}`);
  }

  // --- Empleados ---
  empleados(filtro: { tipoNomina?: string; estado?: string; adscripcionId?: number; q?: string; limite?: number; desde?: number }) {
    return this.http.get<{ total: number; empleados: EmpleadoResumen[] }>(`${this.url}/empleados`, { params: sinVacios(filtro) });
  }

  empleado(id: number): Observable<FichaEmpleado> {
    return this.http.get<FichaEmpleado>(`${this.url}/empleados/${id}`);
  }

  quincenaEmpleado(id: number): Observable<QuincenaEmpleado> {
    return this.http.get<QuincenaEmpleado>(`${this.url}/empleados/${id}/quincena`);
  }

  crearEmpleado(datos: Record<string, unknown>): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.url}/empleados`, datos);
  }

  actualizarEmpleado(id: number, datos: Record<string, unknown>): Observable<FichaEmpleado> {
    return this.http.patch<FichaEmpleado>(`${this.url}/empleados/${id}`, datos);
  }

  cambiarCurp(id: number, curp: string): Observable<void> {
    return this.http.put<void>(`${this.url}/empleados/${id}/curp`, { curp });
  }

  fijarConcepto(id: number, conceptoId: number, datos: { importe: number; gravaIsr?: boolean | null; timbra?: boolean | null }): Observable<void> {
    return this.http.put<void>(`${this.url}/empleados/${id}/conceptos/${conceptoId}`, datos);
  }

  quitarConcepto(id: number, conceptoId: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/empleados/${id}/conceptos/${conceptoId}`);
  }

  guardarDescuento(id: number, datos: Record<string, unknown>, descuentoId?: number): Observable<void> {
    return descuentoId
      ? this.http.put<void>(`${this.url}/empleados/${id}/descuentos/${descuentoId}`, datos)
      : this.http.post<void>(`${this.url}/empleados/${id}/descuentos`, datos);
  }

  quitarDescuento(id: number, descuentoId: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/empleados/${id}/descuentos/${descuentoId}`);
  }

  guardarCuentaContable(id: number, conceptoId: number, partida: string): Observable<void> {
    return this.http.put<void>(`${this.url}/empleados/${id}/cuentas-contables`, { conceptoId, partida });
  }

  quitarCuentaContable(id: number, cuentaId: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/empleados/${id}/cuentas-contables/${cuentaId}`);
  }

  guardarSucursal(id: number, sucursal: number | null, tipo: string): Observable<void> {
    return this.http.put<void>(`${this.url}/empleados/${id}/sucursal`, { sucursal, tipo });
  }

  movimiento(id: number, tipo: 'baja' | 'permiso' | 'reingreso', datos: Record<string, unknown>): Observable<void> {
    return this.http.post<void>(`${this.url}/empleados/${id}/${tipo}`, datos);
  }

  movimientos(filtro: { tipo?: string; desde?: string; hasta?: string; tipoNomina?: string }): Observable<MovimientoLista[]> {
    return this.http.get<MovimientoLista[]>(`${this.url}/movimientos`, { params: sinVacios(filtro) });
  }

  cancelarMovimiento(id: number): Observable<void> {
    return this.http.post<void>(`${this.url}/movimientos/${id}/cancelar`, {});
  }

  // --- Quincenas ---
  periodos(tipoNomina: string): Observable<Periodo[]> {
    return this.http.get<Periodo[]>(`${this.url}/periodos`, { params: { tipoNomina } });
  }

  periodoActual(tipoNomina: string): Observable<Periodo | null> {
    return this.http.get<Periodo | null>(`${this.url}/periodos/actual`, { params: { tipoNomina } });
  }

  periodo(id: number): Observable<PeriodoDetalle> {
    return this.http.get<PeriodoDetalle>(`${this.url}/periodos/${id}`);
  }

  abrirPeriodo(datos: { tipoNomina: string; anio: number; quincena: number; fechaPago?: string }): Observable<Periodo> {
    return this.http.post<Periodo>(`${this.url}/periodos`, datos);
  }

  fechaPago(id: number, fechaPago: string): Observable<Periodo> {
    return this.http.patch<Periodo>(`${this.url}/periodos/${id}`, { fechaPago });
  }

  cerrarPeriodo(id: number): Observable<Periodo> {
    return this.http.post<Periodo>(`${this.url}/periodos/${id}/cerrar`, {});
  }

  origenes(): Observable<{ clave: string; nombre: string; sistema: boolean }[]> {
    return this.http.get<{ clave: string; nombre: string; sistema: boolean }[]>(`${this.url}/capturas/origenes`);
  }

  /** Las más recientes que cumplen el filtro (hasta 500); los totales están en resumenCapturas. */
  capturas(periodoId: number, filtro: { empleadoId?: number; origen?: string; q?: string } = {}): Observable<Captura[]> {
    return this.http.get<Captura[]>(`${this.url}/periodos/${periodoId}/capturas`, { params: sinVacios(filtro) });
  }

  /** Totales de todo lo capturado que cumple el filtro. `desde`: cuántas se capturaron después de cada fecha. */
  resumenCapturas(periodoId: number, filtro: { empleadoId?: number; origen?: string; q?: string; desde?: string[] } = {}) {
    const { desde, ...resto } = filtro;
    let params = new HttpParams({ fromObject: sinVacios(resto) });
    for (const d of desde ?? []) params = params.append('desde', d);
    return this.http.get<{ total: number; personas: number; p: number; d: number; posteriores: number[] }>(
      `${this.url}/periodos/${periodoId}/capturas/resumen`,
      { params },
    );
  }

  capturar(periodoId: number, datos: { empleadoId: number; conceptoId: number; importe: number; referencia?: string; gravaIsr?: boolean | null; timbra?: boolean | null }) {
    return this.http.post<{ id: number }>(`${this.url}/periodos/${periodoId}/capturas`, datos);
  }

  probarCaptura(
    periodoId: number,
    datos: { empleadoId: number; conceptoId: number; importe: number; gravaIsr?: boolean | null; timbra?: boolean | null; fija?: boolean },
  ): Observable<ImpactoMovimiento> {
    return this.http.post<ImpactoMovimiento>(`${this.url}/periodos/${periodoId}/capturas/probar`, datos);
  }

  marcarCaptura(id: number, marcas: { gravaIsr: boolean | null; timbra: boolean | null }): Observable<void> {
    return this.http.patch<void>(`${this.url}/capturas/${id}`, marcas);
  }

  borrarCaptura(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/capturas/${id}`);
  }

  ajustesQuincena(periodoId: number): Observable<AjusteQuincena[]> {
    return this.http.get<AjusteQuincena[]>(`${this.url}/periodos/${periodoId}/ajustes`);
  }

  /** gravaIsr / timbra en null = como el catálogo; si ambos quedan así, el ajuste se quita. */
  ajustarQuincena(periodoId: number, datos: { conceptoId: number; gravaIsr: boolean | null; timbra: boolean | null; motivo?: string }): Observable<AjusteQuincena[]> {
    return this.http.post<AjusteQuincena[]>(`${this.url}/periodos/${periodoId}/ajustes`, datos);
  }

  ajusteNeto(periodoId: number, empleadoId: number): Observable<AjusteNeto> {
    return this.http.get<AjusteNeto>(`${this.url}/periodos/${periodoId}/ajuste-neto/${empleadoId}`);
  }

  /** Sin importe, el servidor busca el mínimo que deja el neto en `objetivo`. No guarda nada. */
  probarAjusteNeto(periodoId: number, datos: { empleadoId: number; conceptoId: number; importe?: number; objetivo?: number }) {
    return this.http.post<{ importe: number; recibo: ReciboPrueba }>(`${this.url}/periodos/${periodoId}/ajuste-neto/probar`, datos);
  }

  aplicarAjusteNeto(periodoId: number, datos: { empleadoId: number; conceptoId: number; importe: number; motivo?: string }): Observable<AjusteNeto> {
    return this.http.post<AjusteNeto>(`${this.url}/periodos/${periodoId}/ajuste-neto`, datos);
  }

  vistaRetroactivo(periodoId: number, desde: string): Observable<VistaRetroactivo> {
    return this.http.post<VistaRetroactivo>(`${this.url}/periodos/${periodoId}/retroactivo/vista-previa`, { desde });
  }

  aplicarRetroactivo(periodoId: number, desde: string): Observable<VistaRetroactivo> {
    return this.http.post<VistaRetroactivo>(`${this.url}/periodos/${periodoId}/retroactivo`, { desde });
  }

  importarTablaRang(archivo: File, vigencia: string, aplicar: boolean): Observable<ResultadoTablaRang> {
    const datos = new FormData();
    datos.append('archivo', archivo);
    datos.append('vigencia', vigencia);
    datos.append('aplicar', String(aplicar));
    return this.http.post<ResultadoTablaRang>(`${this.url}/catalogos/tabulador/importar`, datos);
  }

  calcular(periodoId: number, tipo: TipoCalculo): Observable<Calculo> {
    return this.http.post<Calculo>(`${this.url}/periodos/${periodoId}/calcular`, { tipo });
  }

  calculo(id: number): Observable<Calculo> {
    return this.http.get<Calculo>(`${this.url}/calculos/${id}`);
  }

  recibos(calculoId: number, filtro: { q?: string; desde?: number; limite?: number; observados?: boolean }) {
    return this.http.get<{ total: number; recibos: ReciboFila[] }>(`${this.url}/calculos/${calculoId}/recibos`, {
      params: sinVacios(filtro),
    });
  }

  recibo(id: number): Observable<ReciboDetalle> {
    return this.http.get<ReciboDetalle>(`${this.url}/recibos/${id}`);
  }

  diagnosticos(periodoId: number): Observable<{ calculoId: number | null; diagnosticos: Diagnostico[] }> {
    return this.http.get<{ calculoId: number | null; diagnosticos: Diagnostico[] }>(`${this.url}/periodos/${periodoId}/diagnosticos`);
  }

  dispersion(calculoId: number): Observable<ResumenDispersion> {
    return this.http.get<ResumenDispersion>(`${this.url}/calculos/${calculoId}/dispersion`);
  }

  /** Archivos: PDF, Excel o el layout del banco. */
  archivo(ruta: string, params: Record<string, string | number | undefined> = {}): Observable<Blob> {
    return this.http.get(`${this.url}/${ruta}`, { params: sinVacios(params) as Record<string, string>, responseType: 'blob' });
  }

  analisis(tipoNomina: string, anio?: number): Observable<DatosAnalisis> {
    return this.http.get<DatosAnalisis>(`${this.url}/analisis`, { params: sinVacios({ tipoNomina, anio }) as Record<string, string> });
  }

  // --- Reportes y procesos ---
  reportes(): Observable<DefinicionReporte[]> {
    return this.http.get<DefinicionReporte[]>(`${this.url}/reportes`);
  }

  reporte(clave: string, filtro: Record<string, string | number | undefined>): Observable<TablaReporte> {
    return this.http.get<TablaReporte>(`${this.url}/reportes/${clave}`, { params: sinVacios(filtro) as Record<string, string> });
  }

  vistaAumento(datos: { porcentaje: number; niveles?: number[]; incluirCompensacion?: boolean; vigencia?: string }) {
    return this.http.post<{
      vigencia: string;
      renglones: {
        id: number; nivel: number; rango: number; sueldoAntes: number; sueldoDespues: number;
        compensacionAntes: number; compensacionDespues: number; gratificacionAntes: number; gratificacionDespues: number;
      }[];
      empleados: number;
    }>(`${this.url}/procesos/aumento-salarial/vista-previa`, datos);
  }

  aplicarAumento(datos: { porcentaje: number; niveles?: number[]; incluirCompensacion?: boolean; vigencia?: string }) {
    return this.http.post<{ actualizados: number }>(`${this.url}/procesos/aumento-salarial`, datos);
  }

  simular(datos: { tipoNomina: string; nivel: number; rango: number; dias?: number; fijos?: { conceptoId: number; importe: number }[] }) {
    return this.http.post<ResultadoSimulacion>(`${this.url}/procesos/simulador`, datos);
  }

  // --- Administración ---
  usuarios(): Observable<{ roles: { clave: string; nombre: string }[]; usuarios: UsuarioSistema[] }> {
    return this.http.get<{ roles: { clave: string; nombre: string }[]; usuarios: UsuarioSistema[] }>(`${this.url}/usuarios`);
  }

  crearUsuario(datos: { usuario: string; nombre: string; rol: string; password: string }): Observable<UsuarioSistema> {
    return this.http.post<UsuarioSistema>(`${this.url}/usuarios`, datos);
  }

  editarUsuario(id: number, datos: Partial<{ nombre: string; rol: string; activo: boolean; password: string }>) {
    return this.http.patch<UsuarioSistema>(`${this.url}/usuarios/${id}`, datos);
  }

  masivas(periodoId: number): Observable<MasivaHecha[]> {
    return this.http.get<MasivaHecha[]>(`${this.url}/periodos/${periodoId}/masivas`);
  }

  vistaMasiva(periodoId: number, datos: DatosMasiva): Observable<VistaMasiva> {
    return this.http.post<VistaMasiva>(`${this.url}/periodos/${periodoId}/masivas/vista-previa`, datos);
  }

  aplicarMasiva(periodoId: number, datos: DatosMasiva & { personas: number }) {
    return this.http.post<{ id: number; personas: number }>(`${this.url}/periodos/${periodoId}/masivas`, datos);
  }

  deshacerMasiva(periodoId: number, id: number) {
    return this.http.post<{ borradas: number }>(`${this.url}/periodos/${periodoId}/masivas/${id}/deshacer`, {});
  }

  sistemasExternos(): Observable<SistemaExterno[]> {
    return this.http.get<SistemaExterno[]>(`${this.url}/otros-sistemas`);
  }

  movimientosExternos(sistema: string, filtro: { estado?: string; tipo?: string; q?: string; desde?: number }) {
    return this.http.get<{ total: number; porTipo: Record<string, number>; movimientos: MovimientoExterno[] }>(`${this.url}/otros-sistemas/${sistema}`, { params: sinVacios(filtro) });
  }

  traerExternos(sistema: string) {
    return this.http.post<{ nuevos: number }>(`${this.url}/otros-sistemas/${sistema}/traer`, {});
  }

  aplicarExternos(sistema: string, ids: number[]) {
    return this.http.post<{ aplicados: number; errores: { id: number; nombre: string; error: string }[]; aviso: string | null }>(`${this.url}/otros-sistemas/${sistema}/aplicar`, { ids });
  }

  descartarExternos(sistema: string, ids: number[], motivo: string, hecho: boolean) {
    return this.http.post<{ descartados: number }>(`${this.url}/otros-sistemas/${sistema}/descartar`, { ids, motivo, hecho });
  }

  restaurarExterno(sistema: string, id: number): Observable<void> {
    return this.http.post<void>(`${this.url}/otros-sistemas/${sistema}/${id}/restaurar`, {});
  }

  bitacora(filtro: { entidad?: string; usuario?: string; q?: string; dia?: string; desde?: number }): Observable<RegistroBitacora[]> {
    return this.http.get<RegistroBitacora[]>(`${this.url}/bitacora`, { params: sinVacios(filtro) });
  }
}
