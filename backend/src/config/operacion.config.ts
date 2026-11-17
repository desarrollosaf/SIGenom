import { registerAs } from '@nestjs/config';

export default registerAs('operacion', () => ({
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  workerLote: parseInt(process.env.WORKER_LOTE ?? '250', 10),
  workerConcurrencia: parseInt(process.env.WORKER_CONCURRENCIA ?? '2', 10),
}));
