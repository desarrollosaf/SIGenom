import { Global, Module } from '@nestjs/common';
import { SigenomDbModule } from '../database/sigenom-db.module';
import { BitacoraService } from './bitacora.service';
import { EntradaService } from './entrada.service';
import { TablasService } from './tablas.service';

/** Servicios que usan casi todos los módulos. Global para no importarlo en cada uno. */
@Global()
@Module({
  imports: [SigenomDbModule],
  providers: [BitacoraService, TablasService, EntradaService],
  exports: [SigenomDbModule, BitacoraService, TablasService, EntradaService],
})
export class CompartidoModule {}
