import { Module } from '@nestjs/common';
import { AnalisisModule } from './analisis/analisis.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthModule } from './auth/jwt-auth.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { ConsultaModule } from './consulta/consulta.module';
import { CompartidoModule } from './common/compartido.module';
import { CONEXIONES } from './config/conexiones';
import { DispersionModule } from './dispersion/dispersion.module';
import { EmpleadosModule } from './empleados/empleados.module';
import { IntegracionesModule } from './integraciones/integraciones.module';
import { ProcesosModule } from './procesos/procesos.module';
import { QuincenaModule } from './quincena/quincena.module';
import { ReportesModule } from './reportes/reportes.module';
import { TableroModule } from './tablero/tablero.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { VerificacionModule } from './verificacion/verificacion.module';

@Module({
  imports: [
    ...CONEXIONES,
    CompartidoModule,
    JwtAuthModule,
    AuthModule,
    UsuariosModule,
    CatalogosModule,
    EmpleadosModule,
    QuincenaModule,
    VerificacionModule,
    DispersionModule,
    ReportesModule,
    ProcesosModule,
    TableroModule,
    AnalisisModule,
    IntegracionesModule,
    ConsultaModule,
  ],
})
export class AppModule {}
