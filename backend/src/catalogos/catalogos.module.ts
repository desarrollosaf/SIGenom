import { Module } from '@nestjs/common';
import { CatalogosController } from './catalogos.controller';
import { CatalogosService } from './catalogos.service';
import { TablaRangService } from './tabla-rang.service';

@Module({
  controllers: [CatalogosController],
  providers: [CatalogosService, TablaRangService],
  exports: [CatalogosService],
})
export class CatalogosModule {}
