import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { COLA_CALCULOS } from '../config/conexiones';
import { CalculosService } from './calculos.service';
import { CapturasService } from './capturas.service';
import { PeriodosService } from './periodos.service';
import { QuincenaController } from './quincena.controller';
import { ReciboPdfService } from './recibo-pdf.service';

/** Lado API: abre quincenas, captura y encola cálculos. No procesa la cola. */
@Module({
  imports: [BullModule.registerQueue({ name: COLA_CALCULOS })],
  controllers: [QuincenaController],
  providers: [PeriodosService, CapturasService, CalculosService, ReciboPdfService],
  exports: [PeriodosService, CalculosService],
})
export class QuincenaModule {}
