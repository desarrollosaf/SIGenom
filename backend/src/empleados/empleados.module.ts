import { Module } from '@nestjs/common';
import { EmpleadosController, MovimientosController } from './empleados.controller';
import { EmpleadosService } from './empleados.service';
import { MovimientosService } from './movimientos.service';
import { QuincenaEmpleadoService } from './quincena-empleado.service';

@Module({
  controllers: [EmpleadosController, MovimientosController],
  providers: [EmpleadosService, MovimientosService, QuincenaEmpleadoService],
  exports: [EmpleadosService, MovimientosService],
})
export class EmpleadosModule {}
