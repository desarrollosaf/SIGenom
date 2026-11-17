import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/** Punto de entrada del worker: `node dist/worker.js`. Se escala levantando más contenedores. */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('Worker').log('Esperando cálculos en la cola…');
}
void bootstrap();
