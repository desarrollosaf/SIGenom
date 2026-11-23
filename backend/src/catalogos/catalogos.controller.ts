import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PUEDEN_OPERAR, Usuario, type UsuarioActual } from '../common/usuario-actual';
import { CatalogosService } from './catalogos.service';
import { TablaRangService } from './tabla-rang.service';

@Controller('catalogos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogosController {
  constructor(
    private readonly catalogos: CatalogosService,
    private readonly tablaRang: TablaRangService,
  ) {}

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

  /** Tabla-rang del sistema anterior: primero se revisa (aplicar=false) y luego se guarda. */
  @Post('tabulador/importar')
  @Roles(...PUEDEN_OPERAR)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 1024 * 1024 } }))
  importarTablaRang(
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @Body('vigencia') vigencia: string,
    @Body('aplicar') aplicar: string,
    @Usuario() usuario: UsuarioActual,
  ) {
    if (!archivo) throw new BadRequestException('Adjunta el archivo de la tabla-rang.');
    return this.tablaRang.importar(archivo.buffer.toString('latin1').replace(/^\u00ef\u00bb\u00bf/, ''), vigencia ?? '', aplicar === 'true', usuario.usuario);
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
