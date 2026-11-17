import { Controller, Get, Module, Param, ParseIntPipe, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { hoyMexico } from '../common/fechas';
import { PUEDEN_OPERAR } from '../common/usuario-actual';
import { QuincenaModule } from '../quincena/quincena.module';
import { DispersionService } from './dispersion.service';

@Controller('calculos/:id/dispersion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DispersionController {
  constructor(private readonly dispersion: DispersionService) {}

  @Get()
  resumen(@Param('id', ParseIntPipe) id: number) {
    return this.dispersion.resumen(id);
  }

  @Get('archivo')
  @Roles(...PUEDEN_OPERAR)
  async archivo(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
    @Query('layout') layout = 'citibanamex',
    @Query('fecha') fecha?: string,
    @Query('secuencia') secuencia?: string,
  ) {
    const { nombre, contenido } = await this.dispersion.archivo(id, layout, fecha || hoyMexico(), Number(secuencia) || 1);
    res.setHeader('Content-Type', layout === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=us-ascii');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  }
}

@Module({
  imports: [QuincenaModule],
  controllers: [DispersionController],
  providers: [DispersionService],
})
export class DispersionModule {}
