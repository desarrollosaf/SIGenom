import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule, SequelizeModuleOptions } from '@nestjs/sequelize';
import { MODELOS } from '../database/sigenom-db.module';
import authConfig from './auth.config';
import databaseConfig from './database.config';
import operacionConfig from './operacion.config';

/** Lo que comparten la API y el worker: configuración, PostgreSQL y Redis. */
export const CONEXIONES = [
  ConfigModule.forRoot({
    isGlobal: true,
    load: [databaseConfig, authConfig, operacionConfig],
  }),
  SequelizeModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService): SequelizeModuleOptions => ({
      dialect: 'postgres',
      ...config.get('database'),
      models: MODELOS,
      autoLoadModels: true,
      // El esquema lo manejan las migraciones; nunca se sincroniza solo.
      synchronize: false,
      logging: false,
      timezone: 'America/Mexico_City',
      pool: { max: 10 },
    }),
  }),
  BullModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({
      connection: config.getOrThrow<{ host: string; port: number }>('operacion.redis'),
      defaultJobOptions: { removeOnComplete: 200, removeOnFail: 500 },
    }),
  }),
];

/** Nombre de la cola de cálculos. */
export const COLA_CALCULOS = 'calculos';
