import { Controller, Get, Module, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { tablaAExcel } from '../common/excel';
import { FiltrosReporte, ReportesService } from './reportes.service';

const leerFiltros = (q: Record<string, string | undefined>): FiltrosReporte => ({
  calculoId: q['calculoId'] ? Number(q['calculoId']) : undefined,
  tipoNomina: q['tipoNomina'],
  anio: q['anio'] ? Number(q['anio']) : undefined,
  mes: q['mes'] ? Number(q['mes']) : undefined,
  orden: q['orden'],
});

@Controller('reportes')
@UseGuards(JwtAuthGuard)
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get()
  catalogo() {
    return this.reportes.catalogo();
  }

  @Get(':clave')
  ejecutar(@Param('clave') clave: string, @Query() q: Record<string, string>) {
    return this.reportes.ejecutar(clave, leerFiltros(q));
  }

  @Get(':clave/excel')
  async excel(@Param('clave') clave: string, @Query() q: Record<string, string>, @Res() res: Response) {
    const tabla = await this.reportes.ejecutar(clave, leerFiltros(q));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${clave}.xlsx"`);
    res.send(await tablaAExcel(tabla));
  }
}

@Module({
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}
