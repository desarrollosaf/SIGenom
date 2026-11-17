import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ContextoService } from '../../core/services/contexto.service';
import { NOMBRE_CALCULO, type Tablero } from '../../core/services/modelos';
import { Icono, NombreIcono } from '../../shared/icono/icono';
import { FORMATO } from '../../shared/formato';

interface Paso {
  titulo: string;
  detalle: string;
  ruta: string;
  icono: NombreIcono;
  estado: 'hecho' | 'actual' | 'pendiente';
}

@Component({
  selector: 'app-inicio',
  imports: [RouterLink, Icono, ...FORMATO],
  templateUrl: './inicio.html',
  styleUrl: './inicio.scss',
})
export class Inicio {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  protected readonly contexto = inject(ContextoService);

  protected readonly datos = signal<Tablero | null>(null);
  protected readonly cargando = signal(true);
  protected readonly nombres = NOMBRE_CALCULO;

  protected readonly saludo = computed(() => {
    const hora = Number(new Intl.DateTimeFormat('es-MX', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Mexico_City' }).format(new Date()));
    const parte = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
    return `${parte}, ${(this.auth.currentUser()?.nombre ?? '').split(' ')[0]}`;
  });

  /** El último cálculo vigente de nómina o prenómina: de ahí salen las cifras. */
  protected readonly ultimo = computed(
    () => this.datos()?.calculos.find((c) => c.estado === 'terminado' && (c.tipo === 'nomina' || c.tipo === 'prenomina')) ?? null,
  );

  /** En qué paso va la quincena. Es el flujo que antes había que recordar entre 1MEN-NOM y 1MENU2. */
  protected readonly pasos = computed<Paso[]>(() => {
    const d = this.datos();
    const p = d?.periodo;
    const hechos = new Set(d?.calculos.filter((c) => c.estado === 'terminado').map((c) => c.tipo));
    const estado = p?.estado ?? 'captura';
    const orden = ['captura', 'prenomina', 'verificacion', 'nomina', 'pagos', 'cierre'];
    const actual =
      estado === 'cerrado' ? 6 : estado === 'nomina' ? 4 : estado === 'prenomina' ? (hechos.has('nomina') ? 4 : 2) : (hechos.has('prenomina') ? 2 : 0);
    const marca = (i: number): Paso['estado'] => (i < actual ? 'hecho' : i === actual ? 'actual' : 'pendiente');
    const capturas = d?.capturas;
    return [
      { titulo: 'Captura', detalle: capturas ? `${capturas.total} movimientos de ${capturas.empleados} personas` : '', ruta: '/proceso', icono: 'captura' as const },
      { titulo: 'Prenómina', detalle: hechos.has('prenomina') ? 'Calculada' : 'Cálculo de revisión', ruta: '/proceso', icono: 'calculo' as const },
      { titulo: 'Verificación', detalle: 'Diagnósticos antes de pagar', ruta: '/proceso', icono: 'verificar' as const },
      { titulo: 'Nómina', detalle: hechos.has('nomina') ? 'Calculada' : 'Cálculo definitivo', ruta: '/proceso', icono: 'calculo' as const },
      { titulo: 'Dispersión', detalle: 'Archivo del banco y cheques', ruta: '/proceso', icono: 'banco' as const },
      { titulo: 'Cierre', detalle: estado === 'cerrado' ? 'Quincena cerrada' : 'Congela la quincena', ruta: '/proceso', icono: 'candado' as const },
    ].map((paso, i) => ({ ...paso, estado: marca(i), clave: orden[i] }));
  });

  /** Barras del histórico, normalizadas al neto más alto. */
  protected readonly barras = computed(() => {
    const historico = this.datos()?.historico ?? [];
    const maximo = Math.max(...historico.map((h) => h.neto), 1);
    return historico.map((h) => ({ ...h, alto: Math.max(4, (h.neto / maximo) * 100) }));
  });

  constructor() {
    effect(() => {
      const tipo = this.contexto.tipoNomina();
      this.cargando.set(true);
      this.api.tablero(tipo).subscribe({
        next: (d) => {
          this.datos.set(d);
          this.cargando.set(false);
        },
        error: () => this.cargando.set(false),
      });
    });
  }
}
