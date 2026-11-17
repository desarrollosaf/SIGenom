import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PUEDEN_OPERAR, Usuario, type UsuarioActual } from '../common/usuario-actual';
import { CatalogosService } from './catalogos.service';

@Controller('catalogos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  @Get()
  definiciones() {
    return this.catalogos.definiciones();
  }

  @Get('opciones')
  opciones(@Query('tipoNomina') tipoNomina?: string) {
    return this.catalogos.opciones(tipoNomina);
  }

  @Get(':clave')
  listar(@Param('clave') clave: string, @Query('tipoNomina') tipoNomina?: string) {
    return this.catalogos.listar(clave, tipoNomina);
  }

  @Post(':clave')
  @Roles(...PUEDEN_OPERAR)
  crear(
    @Param('clave') clave: string,
    @Body() datos: Record<string, unknown>,
    @Usuario() usuario: UsuarioActual,
  ) {
    return this.catalogos.crear(clave, datos, usuario.usuario);
  }

  @Put(':clave/:id')
  @Roles(...PUEDEN_OPERAR)
  actualizar(
    @Param('clave') clave: string,
    @Param('id') id: string,
    @Body() datos: Record<string, unknown>,
    @Usuario() usuario: UsuarioActual,
  ) {
    return this.catalogos.actualizar(clave, id, datos, usuario.usuario);
  }

  @Delete(':clave/:id')
  @Roles(...PUEDEN_OPERAR)
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminar(@Param('clave') clave: string, @Param('id') id: string, @Usuario() usuario: UsuarioActual) {
    return this.catalogos.eliminar(clave, id, usuario.usuario);
  }
}
