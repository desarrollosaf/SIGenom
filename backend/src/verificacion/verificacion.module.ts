import { Controller, Get, Module, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QuincenaModule } from '../quincena/quincena.module';
import { VerificacionService } from './verificacion.service';

@Controller('periodos/:id/diagnosticos')
@UseGuards(JwtAuthGuard)
export class VerificacionController {
  constructor(private readonly verificacion: VerificacionService) {}

  @Get()
  diagnosticos(@Param('id', ParseIntPipe) id: number) {
    return this.verificacion.diagnosticos(id);
  }
}

@Module({
  imports: [QuincenaModule],
  controllers: [VerificacionController],
  providers: [VerificacionService],
})
export class VerificacionModule {}
