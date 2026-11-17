import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { COLA_CALCULOS } from '../config/conexiones';
import { CalculoEjecutor } from './calculo.ejecutor';
import type { TrabajoCalculo } from './calculos.service';

/** Consume la cola de cálculos. Solo se registra en el proceso worker (worker.module.ts). */
@Processor(COLA_CALCULOS, { concurrency: Number(process.env.WORKER_CONCURRENCIA ?? 2) })
export class CalculoProcessor extends WorkerHost {
  private readonly logger = new Logger(CalculoProcessor.name);

  constructor(private readonly ejecutor: CalculoEjecutor) {
    super();
  }

  async process(job: Job<TrabajoCalculo>): Promise<void> {
    this.logger.log(`Tomando cálculo ${job.data.calculoId} (intento ${job.attemptsMade + 1})`);
    const ultimoIntento = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await this.ejecutor.ejecutar(job.data.calculoId, (porcentaje) => job.updateProgress(porcentaje), ultimoIntento);
  }
}
