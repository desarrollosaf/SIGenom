import { Body, CanActivate, Controller, ExecutionContext, HttpCode, HttpStatus, Injectable, Module, NotFoundException, Post, Req, ServiceUnavailableException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { QueryTypes } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { Empleado } from '../database/models/personal.models';
import { capacidad, CLAVES_INGRESO, LineaRecibo } from './capacidad';

/**
 * Para otros sistemas (préstamos): no es un usuario con sesión, es una llave compartida (CONSULTA_API_LLAVE)
 * en el encabezado x-api-key. Solo abre esta consulta; el resto de SIGenom sigue pidiendo sesión.
 */
@Injectable()
export class LlaveConsultaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const esperada = process.env.CONSULTA_API_LLAVE?.trim() ?? '';
    if (esperada.length < 32) throw new ServiceUnavailableException('La consulta no está configurada en el servidor.');
    const recibida = Buffer.from(String(context.switchToHttp().getRequest<Request>().headers['x-api-key'] ?? ''));
    const b = Buffer.from(esperada);
    if (recibida.length !== b.length || !timingSafeEqual(recibida, b)) throw new UnauthorizedException('Llave inválida.');
    return true;
  }
}

class CurpDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[A-Z\d]\d$/, { message: 'La CURP no tiene un formato válido.' })
  curp: string;
}

interface Fila extends LineaRecibo {
  tipo_nomina: string;
  anio: number;
  quincena: number;
  fuente: string;
}

/** Se toma su último recibo pagado: de una nómina cerrada en SIGenom, o del sistema anterior (TXT). */
@Injectable()
export class ConsultaService {
  constructor(
    private readonly bitacora: BitacoraService,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
  ) {}

  async capacidad(curp: string, origen: string) {
    const personas = await this.empleados.findAll({ where: { curp } });
    if (!personas.length) throw new NotFoundException('No hay nadie con esa CURP en la nómina.');
    const db = this.empleados.sequelize!;
    const resultados: (ReturnType<typeof capacidad> & { nomina: string; activo: boolean; recibo: { anio: number; quincena: number; fuente: string } | null })[] = [];
    for (const e of personas) {
      // Por nómina, el último periodo con recibo; si en el mismo hay cálculo de SIGenom y del anterior, gana SIGenom.
      const filas = await db.query<Fila>(
        `WITH ultimo AS (
           SELECT r.id FROM recibos r
           JOIN calculos c ON c.id = r.calculo_id AND c.estado = 'terminado'
           JOIN periodos p ON p.id = c.periodo_id
           WHERE r.empleado_id = :empleado
             AND (c.tipo = 'legado' OR (c.tipo = 'nomina' AND p.estado = 'cerrado'))
           ORDER BY p.anio DESC, p.quincena DESC, (c.tipo = 'nomina') DESC, c.id DESC
           LIMIT 1)
         SELECT p.tipo_nomina, p.anio, p.quincena, CASE c.tipo WHEN 'legado' THEN 'sistema anterior' ELSE 'SIGenom' END fuente,
                rc.clave, rc.descripcion, rc.naturaleza, rc.importe::float importe
         FROM ultimo u JOIN recibos r ON r.id = u.id JOIN calculos c ON c.id = r.calculo_id JOIN periodos p ON p.id = c.periodo_id
         JOIN recibo_conceptos rc ON rc.recibo_id = r.id`,
        { type: QueryTypes.SELECT, replacements: { empleado: e.id } },
      );
      const activo = e.estado !== 'baja';
      const calculo = capacidad(filas);
      resultados.push({
        nomina: e.tipoNomina,
        activo,
        recibo: filas.length ? { anio: filas[0].anio, quincena: filas[0].quincena, fuente: filas[0].fuente } : null,
        ...calculo,
        // A quien ya no está, o sin recibo, no se le puede descontar.
        maximoDescuento: activo && filas.length ? calculo.maximoDescuento : 0,
      });
    }
    const conRecibo = resultados.filter((r) => r.recibo);
    if (!conRecibo.length) throw new NotFoundException('Esa persona todavía no tiene un recibo pagado.');
    await this.bitacora.registrar({
      usuario: 'API', entidad: 'consulta', entidadId: personas[0].id, accion: 'consulta_capacidad',
      despues: { origen, nominas: conRecibo.map((r) => ({ nomina: r.nomina, quincena: r.recibo, maximo: r.maximoDescuento })) },
    });
    return {
      curp,
      nombre: [personas[0].nombres, personas[0].apellidoPaterno, personas[0].apellidoMaterno].filter(Boolean).join(' '),
      claves: CLAVES_INGRESO,
      nominas: conRecibo,
      // Si cobra en más de una nómina, lo que se puede descontar en total.
      maximoDescuento: Math.round(conRecibo.reduce((s, r) => s + r.maximoDescuento * 100, 0)) / 100,
    };
  }
}

@Controller('consulta')
@UseGuards(LlaveConsultaGuard)
export class ConsultaController {
  constructor(private readonly consulta: ConsultaService) {}

  /** POST y no GET: así la CURP no queda en las bitácoras de los servidores ni en el historial. */
  @Post('capacidad-descuento')
  @HttpCode(HttpStatus.OK)
  capacidad(@Body() dto: CurpDto, @Req() req: Request) {
    return this.consulta.capacidad(dto.curp, req.ip ?? 'desconocido');
  }
}

@Module({ controllers: [ConsultaController], providers: [ConsultaService] })
export class ConsultaModule {}
