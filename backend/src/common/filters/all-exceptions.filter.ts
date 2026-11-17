import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

// Traduce las frases más comunes que arma class-validator, para no mostrar mensajes en inglés.
const REEMPLAZOS: [RegExp, string][] = [
  [/should not be empty/g, 'no debe estar vacío'],
  [/must be longer than or equal to (\d+) characters/g, 'debe tener al menos $1 caracteres'],
  [/must be shorter than or equal to (\d+) characters/g, 'debe tener máximo $1 caracteres'],
  [/must be a string/g, 'debe ser texto'],
  [/must be an integer number/g, 'debe ser un número entero'],
  [/must be a number conforming to the specified constraints/g, 'debe ser un número válido'],
  [/must be a number/g, 'debe ser un número'],
  [/must be a valid ISO 8601 date string/g, 'debe ser una fecha válida'],
  [/must be a boolean value/g, 'debe ser verdadero o falso'],
  [/must be one of the following values: (.*)/g, 'debe ser uno de: $1'],
  [/must not be less than (\S+)/g, 'no debe ser menor que $1'],
  [/must not be greater than (\S+)/g, 'no debe ser mayor que $1'],
  [/must match (.*) regular expression/g, 'no tiene el formato esperado'],
];

const traducir = (mensaje: string) =>
  REEMPLAZOS.reduce((acc, [patron, reemplazo]) => acc.replace(patron, reemplazo), mensaje);

/** Errores de PostgreSQL que son culpa del dato, no del sistema: se explican al usuario. */
const ERRORES_PG: Record<string, [number, string]> = {
  '23505': [HttpStatus.CONFLICT, 'Ya existe un registro con esa clave.'],
  '23503': [
    HttpStatus.CONFLICT,
    'No se puede: el registro está en uso o hace referencia a uno que no existe.',
  ],
  '22001': [HttpStatus.BAD_REQUEST, 'Uno de los textos es más largo de lo permitido.'],
  '22003': [HttpStatus.BAD_REQUEST, 'Uno de los importes está fuera de rango.'],
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (
        typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as { message?: unknown }).message)
      ) {
        const original = body as { message: string[] };
        response
          .status(status)
          .json({ ...original, message: [...new Set(original.message.map(traducir))] });
        return;
      }
      response.status(status).json(body);
      return;
    }

    // Los errores de Sequelize traen el de PostgreSQL en `parent`.
    const pg = (exception as { parent?: { code?: string; message?: string; detail?: string } })
      ?.parent;
    const conocido = pg?.code ? ERRORES_PG[pg.code] : undefined;
    if (conocido) {
      response.status(conocido[0]).json({ statusCode: conocido[0], message: conocido[1] });
      return;
    }

    this.logger.error(
      `Error no controlado${pg?.message ? `: ${pg.message} ${pg.detail ?? ''}` : ''}`,
      exception instanceof Error ? exception.stack : exception,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Ocurrió un error inesperado. Intenta de nuevo o contacta al administrador.',
    });
  }
}
