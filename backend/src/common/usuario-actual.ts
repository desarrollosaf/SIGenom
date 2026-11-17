import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Todo, incluidos usuarios y cierre de quincena. */
export const ROL_ADMINISTRADOR = 'administrador';
/** Captura, cálculo, catálogos y reportes. */
export const ROL_NOMINISTA = 'nominista';
/** Solo consulta y reportes. */
export const ROL_CONSULTA = 'consulta';

export const ROLES = [
  { clave: ROL_ADMINISTRADOR, nombre: 'Administrador' },
  { clave: ROL_NOMINISTA, nombre: 'Nominista' },
  { clave: ROL_CONSULTA, nombre: 'Consulta' },
];

export const PUEDEN_OPERAR = [ROL_ADMINISTRADOR, ROL_NOMINISTA];

/** Lo que guarda el token: `sub` es `usuarios.id`. */
export interface UsuarioActual {
  sub: number;
  usuario: string;
  rol: string;
}

/** Lo que el frontend usa para mostrar u ocultar opciones; el backend vuelve a validar cada una. */
export function capacidades(rol: string) {
  const opera = PUEDEN_OPERAR.includes(rol);
  return {
    capturar: opera,
    calcular: opera,
    catalogos: opera,
    cerrar: rol === ROL_ADMINISTRADOR,
    administrar: rol === ROL_ADMINISTRADOR,
  };
}

/** Inyecta en el handler el payload del token que dejó JwtAuthGuard en `request.user`. */
export const Usuario = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioActual => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request['user'] as UsuarioActual;
  },
);
