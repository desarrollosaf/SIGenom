import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { capacidadGuard } from './core/guards/capacidad.guard';

const t = (titulo: string) => `${titulo} · SIGenom`;

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
      { path: 'inicio', title: t('Inicio'), loadComponent: () => import('./features/inicio/inicio').then((m) => m.Inicio) },
      {
        path: 'empleados',
        title: t('Empleados'),
        loadComponent: () => import('./features/empleados/lista/lista').then((m) => m.ListaEmpleados),
      },
      {
        path: 'empleados/nuevo',
        title: t('Alta de empleado'),
        canActivate: [capacidadGuard('capturar')],
        loadComponent: () => import('./features/empleados/nuevo/nuevo').then((m) => m.NuevoEmpleado),
      },
      {
        path: 'empleados/:id',
        title: t('Empleado'),
        loadComponent: () => import('./features/empleados/ficha/ficha').then((m) => m.FichaEmpleadoPagina),
      },
      {
        path: 'movimientos',
        title: t('Movimientos'),
        loadComponent: () => import('./features/movimientos/movimientos').then((m) => m.Movimientos),
      },
      {
        path: 'proceso',
        title: t('Proceso de nómina'),
        loadComponent: () => import('./features/proceso/proceso').then((m) => m.Proceso),
      },
      { path: 'captura', title: t('Captura'), loadComponent: () => import('./features/captura/captura').then((m) => m.CapturaPagina) },
      { path: 'calculo', title: t('Cálculo'), loadComponent: () => import('./features/calculo/calculo').then((m) => m.CalculoPagina) },
      {
        path: 'verificacion',
        title: t('Verificación'),
        loadComponent: () => import('./features/verificacion/verificacion').then((m) => m.Verificacion),
      },
      { path: 'pagos', title: t('Pagos'), loadComponent: () => import('./features/pagos/pagos').then((m) => m.Pagos) },
      {
        path: 'quincenas',
        title: t('Quincenas'),
        loadComponent: () => import('./features/quincenas/quincenas').then((m) => m.Quincenas),
      },
      { path: 'reportes', title: t('Reportes'), loadComponent: () => import('./features/reportes/reportes').then((m) => m.Reportes) },
      {
        path: 'analisis',
        title: t('Análisis de ISR'),
        loadComponent: () => import('./features/analisis/analisis').then((m) => m.Analisis),
      },
      {
        path: 'simulador',
        title: t('Estimador de sueldo'),
        loadComponent: () => import('./features/simulador/simulador').then((m) => m.Simulador),
      },
      {
        path: 'catalogos',
        title: t('Catálogos'),
        canActivate: [capacidadGuard('catalogos')],
        loadComponent: () => import('./features/catalogos/catalogos').then((m) => m.Catalogos),
      },
      {
        path: 'catalogos/:clave',
        title: t('Catálogos'),
        canActivate: [capacidadGuard('catalogos')],
        loadComponent: () => import('./features/catalogos/catalogos').then((m) => m.Catalogos),
      },
      {
        path: 'aumento-salarial',
        title: t('Aumento salarial'),
        canActivate: [capacidadGuard('catalogos')],
        loadComponent: () => import('./features/aumento/aumento').then((m) => m.Aumento),
      },
      {
        path: 'usuarios',
        title: t('Usuarios'),
        canActivate: [capacidadGuard('administrar')],
        loadComponent: () => import('./features/usuarios/usuarios').then((m) => m.Usuarios),
      },
      {
        path: 'bitacora',
        title: t('Bitácora'),
        canActivate: [capacidadGuard('administrar')],
        loadComponent: () => import('./features/bitacora/bitacora').then((m) => m.BitacoraPagina),
      },
      { path: 'mi-cuenta', title: t('Mi cuenta'), loadComponent: () => import('./features/mi-cuenta/mi-cuenta').then((m) => m.MiCuenta) },
    ],
  },
  { path: '**', redirectTo: '' },
];
