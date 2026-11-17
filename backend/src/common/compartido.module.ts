import { Global, Module } from '@nestjs/common';
import { SigenomDbModule } from '../database/sigenom-db.module';
import { BitacoraService } from './bitacora.service';
import { TablasService } from './tablas.service';

/** Servicios que usan casi todos los módulos. Global para no importarlo en cada uno. */
@Global()
@Module({
  imports: [SigenomDbModule],
  providers: [BitacoraService, TablasService],
  exports: [SigenomDbModule, BitacoraService, TablasService],
})
export class CompartidoModule {}
