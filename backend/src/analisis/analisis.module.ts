import { BadRequestException, Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TablasService } from '../common/tablas.service';

/**
 * Datos para el Análisis de ISR: todas las líneas de los recibos pagados de una nómina en un año,
 * en forma compacta, más la tarifa y el catálogo de claves. El navegador recalcula el ISR con las
 * marcas que la persona cambie, como la "Calculadora ISR Nómina" que trabajaba sobre los TXT.
 */
@Injectable()
export class AnalisisService {
  constructor(
    @InjectConnection() private readonly db: Sequelize,
    private readonly tablas: TablasService,
  ) {}

  async datos(tipoNomina: string, anio: number) {
    const consulta = <T extends object>(sql: string) =>
      this.db.query<T>(sql, { replacements: { tipo: tipoNomina, anio }, type: QueryTypes.SELECT });

    // El cálculo vigente de cada quincena y tipo (nómina, aguinaldo, prima): lo que sí se pagó.
    const calculos = `
      SELECT DISTINCT ON (c.periodo_id, c.tipo) c.id, c.tipo, p.anio, p.quincena, p.estado
      FROM calculos c JOIN periodos p ON p.id = c.periodo_id
      WHERE p.tipo_nomina = :tipo AND p.anio = :anio AND c.estado = 'terminado'
        AND c.tipo IN ('nomina', 'aguinaldo', 'prima_vacacional')
      ORDER BY c.periodo_id, c.tipo, c.id DESC`;

    const [periodos, recibos, lineas, anios] = await Promise.all([
      consulta<{ id: number; tipo: string; anio: number; quincena: number; estado: string }>(`${calculos}`),
      consulta<{ id: number; calculo_id: number; empleado_id: number; nombre: string; rfc: string; adscripcion: string | null; nivel: number; rango: number; dias: string }>(`
        SELECT r.id, r.calculo_id, r.empleado_id, r.nombre, r.rfc, a.descripcion adscripcion, r.nivel, r.rango, r.dias
        FROM recibos r LEFT JOIN adscripciones a ON a.id = r.adscripcion_id
        WHERE r.calculo_id IN (SELECT id FROM (${calculos}) x)
        ORDER BY r.nombre, r.id`),
      consulta<{ recibo_id: number; concepto_id: number; importe: string }>(`
        SELECT rc.recibo_id, rc.concepto_id, rc.importe FROM recibo_conceptos rc
        WHERE rc.recibo_id IN (SELECT r.id FROM recibos r WHERE r.calculo_id IN (SELECT id FROM (${calculos}) x))`),
      consulta<{ anio: number }>(`SELECT DISTINCT anio FROM periodos WHERE tipo_nomina = :tipo ORDER BY anio DESC`),
    ]);

    let tablas;
    try {
      tablas = await this.tablas.paraNomina(tipoNomina, `${anio}-12-31`);
    } catch {
      throw new BadRequestException(`No hay tarifa de ISR vigente para ${anio}.`);
    }

    // Índices en lugar de repetir textos: con miles de recibos la respuesta sigue siendo ligera.
    const indicePeriodo = new Map(periodos.map((p, i) => [p.id, i]));
    const empleados: { id: number; nombre: string; rfc: string; adscripcion: string; nivel: number; rango: number }[] = [];
    const indiceEmpleado = new Map<number, number>();
    const indiceRecibo = new Map<number, number>();
    const listaRecibos = recibos.map((r, i) => {
      if (!indiceEmpleado.has(r.empleado_id)) {
        indiceEmpleado.set(r.empleado_id, empleados.length);
        empleados.push({ id: r.empleado_id, nombre: r.nombre, rfc: r.rfc, adscripcion: r.adscripcion ?? '—', nivel: r.nivel, rango: r.rango });
      }
      indiceRecibo.set(r.id, i);
      return { id: r.id, e: indiceEmpleado.get(r.empleado_id)!, p: indicePeriodo.get(r.calculo_id)!, dias: Number(r.dias) };
    });

    return {
      tipoNomina,
      anio,
      anios: anios.map((a) => a.anio),
      parametros: { umaDiaria: tablas.parametros.umaDiaria, diasQuincena: tablas.parametros.diasQuincena },
      tarifa: tablas.isr.map((f) => [f.limiteInferior, f.cuotaFija, f.porcentaje]),
      subsidio: tablas.subsidio.map((f) => [f.ingresoDesde, f.subsidio]),
      conceptos: [...tablas.conceptos.values()]
        .sort((a, b) => b.naturaleza.localeCompare(a.naturaleza) || a.clave - b.clave)
        .map((c) => ({ id: c.id, clave: c.clave, descripcion: c.descripcion, naturaleza: c.naturaleza, gravaIsr: c.gravaIsr, calculado: c.calculado })),
      periodos: periodos.map((p) => ({ tipo: p.tipo, anio: p.anio, quincena: p.quincena, cerrado: p.estado === 'cerrado' })),
      empleados,
      recibos: listaRecibos,
      // [índice del recibo, concepto, importe en centavos]
      lineas: lineas.map((l) => [indiceRecibo.get(l.recibo_id)!, l.concepto_id, Math.round(Number(l.importe) * 100)]),
    };
  }
}

@Controller('analisis')
@UseGuards(JwtAuthGuard)
export class AnalisisController {
  constructor(private readonly analisis: AnalisisService) {}

  @Get()
  datos(@Query('tipoNomina') tipoNomina = 'P', @Query('anio') anio?: string) {
    const elegido = Number(anio) || new Date().getFullYear();
    return this.analisis.datos(tipoNomina, elegido);
  }
}

@Module({
  controllers: [AnalisisController],
  providers: [AnalisisService],
})
export class AnalisisModule {}
