import { Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { nombreQuincena } from '../common/fechas';
import { PeriodosService } from '../quincena/periodos.service';
import { QuincenaModule } from '../quincena/quincena.module';

/** Lo que se ve al entrar: en qué paso va la quincena, cifras del último cálculo y su tendencia. */
@Injectable()
export class TableroService {
  constructor(
    @InjectConnection() private readonly db: Sequelize,
    private readonly periodos: PeriodosService,
  ) {}

  async resumen(tipoNomina: string) {
    const periodo = await this.periodos.actual(tipoNomina);
    const consulta = <T extends object>(sql: string, extra: Record<string, unknown> = {}) =>
      this.db.query<T>(sql, { replacements: { tipo: tipoNomina, periodo: periodo?.id ?? 0, ...extra }, type: QueryTypes.SELECT });

    const [[plantilla], calculos, [capturas], historico, movimientos] = await Promise.all([
      consulta<{ activos: number; permiso: number; bajas: number }>(
        `SELECT count(*) FILTER (WHERE estado = 'activo')::int activos, count(*) FILTER (WHERE estado = 'permiso')::int permiso,
                count(*) FILTER (WHERE estado = 'baja' AND fecha_baja >= date_trunc('year', now()))::int bajas
         FROM empleados WHERE tipo_nomina = :tipo`,
      ),
      consulta<{ id: number; tipo: string; estado: string; total_neto: string; total_percepciones: string; total_deducciones: string; total_empleados: number; procesados: number; terminado_el: string | null }>(
        `SELECT id, tipo, estado, total_neto, total_percepciones, total_deducciones, total_empleados, procesados, terminado_el
         FROM calculos WHERE periodo_id = :periodo AND estado <> 'reemplazado' ORDER BY id DESC LIMIT 5`,
      ),
      consulta<{ total: number; empleados: number }>(
        `SELECT count(*)::int total, count(DISTINCT empleado_id)::int empleados FROM capturas WHERE periodo_id = :periodo`,
      ),
      consulta<{ anio: number; quincena: number; neto: string; percepciones: string; empleados: number }>(
        `SELECT p.anio, p.quincena, c.total_neto neto, c.total_percepciones percepciones, c.total_empleados empleados
         FROM calculos c JOIN periodos p ON p.id = c.periodo_id
         WHERE p.tipo_nomina = :tipo AND c.tipo = 'nomina' AND c.estado = 'terminado'
         ORDER BY p.anio DESC, p.quincena DESC LIMIT 12`,
      ),
      consulta<{ tipo: string; total: number }>(
        `SELECT m.tipo, count(*)::int total FROM movimientos_personal m JOIN empleados e ON e.id = m.empleado_id
         JOIN periodos p ON p.id = :periodo
         WHERE e.tipo_nomina = :tipo AND NOT m.cancelado AND m.fecha_inicio BETWEEN p.fecha_inicio AND p.fecha_fin
         GROUP BY m.tipo`,
      ),
    ]);

    const num = (v: string | number | null | undefined) => Number(v ?? 0);
    return {
      periodo,
      plantilla,
      capturas,
      movimientos: Object.fromEntries(movimientos.map((m) => [m.tipo, m.total])),
      calculos: calculos.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        estado: c.estado,
        totalNeto: num(c.total_neto),
        totalPercepciones: num(c.total_percepciones),
        totalDeducciones: num(c.total_deducciones),
        totalEmpleados: c.total_empleados,
        procesados: c.procesados,
        terminadoEl: c.terminado_el,
      })),
      historico: historico.reverse().map((h) => ({
        etiqueta: nombreQuincena(h.anio, h.quincena),
        anio: h.anio,
        quincena: h.quincena,
        neto: num(h.neto),
        percepciones: num(h.percepciones),
        empleados: h.empleados,
      })),
    };
  }
}

@Controller('tablero')
@UseGuards(JwtAuthGuard)
export class TableroController {
  constructor(private readonly tablero: TableroService) {}

  @Get()
  resumen(@Query('tipoNomina') tipoNomina = 'P') {
    return this.tablero.resumen(tipoNomina);
  }
}

@Module({
  imports: [QuincenaModule],
  controllers: [TableroController],
  providers: [TableroService],
})
export class TableroModule {}
