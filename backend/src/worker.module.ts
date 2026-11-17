import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CompartidoModule } from './common/compartido.module';
import { COLA_CALCULOS, CONEXIONES } from './config/conexiones';
import { CalculoEjecutor } from './quincena/calculo.ejecutor';
import { CalculoProcessor } from './quincena/calculo.processor';

/** El proceso worker: sin HTTP, solo la base, Redis y el procesador de la cola. */
@Module({
  imports: [...CONEXIONES, CompartidoModule, BullModule.registerQueue({ name: COLA_CALCULOS })],
  providers: [CalculoEjecutor, CalculoProcessor],
})
export class WorkerModule {}
