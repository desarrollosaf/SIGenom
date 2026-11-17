import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService, Capacidades } from '../../core/services/auth.service';
import { ContextoService } from '../../core/services/contexto.service';
import { InactivityService } from '../../core/services/inactivity.service';
import { NOMBRE_ESTADO_PERIODO, type EmpleadoResumen } from '../../core/services/modelos';
import { TemaService } from '../../core/services/tema.service';
import { BuscarEmpleado } from '../../shared/buscar-empleado/buscar-empleado';
import { Icono, NombreIcono } from '../../shared/icono/icono';

interface Entrada {
  ruta: string;
  etiqueta: string;
  icono: NombreIcono;
  requiere?: keyof Capacidades;
}

interface Grupo {
  titulo?: string;
  entradas: Entrada[];
}

/**
 * El menú agrupa lo que en el sistema anterior eran MENU-PRI, 1MEN-NOM, 1MENU2, 1MEN-CAT, 1MEN-ISS,
 * MENU-T-B y men-resp: siete menús anidados que ahora caben en una barra.
 */
const MENU: Grupo[] = [
  { entradas: [{ ruta: '/inicio', etiqueta: 'Inicio', icono: 'inicio' }] },
  {
    titulo: 'Personal',
    entradas: [
      { ruta: '/empleados', etiqueta: 'Empleados', icono: 'personas' },
      { ruta: '/movimientos', etiqueta: 'Movimientos', icono: 'movimientos' },
    ],
  },
  {
    titulo: 'Quincena',
    // Captura, cálculo, verificación y pago viven dentro del asistente; sus rutas siguen existiendo.
    entradas: [
      { ruta: '/proceso', etiqueta: 'Proceso de nómina', icono: 'calculo' },
      { ruta: '/quincenas', etiqueta: 'Historial de quincenas', icono: 'calendario' },
    ],
  },
  {
    titulo: 'Consultas',
    entradas: [
      { ruta: '/reportes', etiqueta: 'Reportes', icono: 'reportes' },
      { ruta: '/analisis', etiqueta: 'Análisis de ISR', icono: 'analisis' },
      { ruta: '/simulador', etiqueta: 'Estimador de sueldo', icono: 'simulador' },
    ],
  },
  {
    titulo: 'Configuración',
    entradas: [
      { ruta: '/catalogos', etiqueta: 'Catálogos', icono: 'catalogos', requiere: 'catalogos' },
      { ruta: '/aumento-salarial', etiqueta: 'Aumento salarial', icono: 'aumento', requiere: 'catalogos' },
      { ruta: '/usuarios', etiqueta: 'Usuarios', icono: 'usuarios', requiere: 'administrar' },
      { ruta: '/bitacora', etiqueta: 'Bitácora', icono: 'bitacora', requiere: 'administrar' },
    ],
  },
];

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icono, BuscarEmpleado],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly tema = inject(TemaService);
  protected readonly inactividad = inject(InactivityService);
  protected readonly contexto = inject(ContextoService);
  private readonly router = inject(Router);

  protected readonly menuAbierto = signal(false);
  protected readonly cuentaAbierta = signal(false);
  protected readonly estados = NOMBRE_ESTADO_PERIODO;

  protected readonly grupos = computed(() => {
    const puede = this.auth.currentUser()?.capacidades;
    return MENU.map((g) => ({ ...g, entradas: g.entradas.filter((e) => !e.requiere || puede?.[e.requiere]) })).filter(
      (g) => g.entradas.length,
    );
  });

  protected readonly iniciales = computed(() =>
    (this.auth.currentUser()?.nombre ?? '')
      .split(/\s+/)
      .slice(0, 2)
      .map((parte) => parte[0])
      .join(''),
  );

  constructor() {
    // En el teléfono el menú se cierra solo al navegar.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.menuAbierto.set(false);
      this.cuentaAbierta.set(false);
    });
  }

  ngOnInit(): void {
    this.inactividad.start();
    this.auth.refrescar();
    this.contexto.iniciar();
  }

  ngOnDestroy(): void {
    this.inactividad.stop();
  }

  protected irA(empleado: EmpleadoResumen): void {
    void this.router.navigate(['/empleados', empleado.id]);
  }

  protected salir(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
