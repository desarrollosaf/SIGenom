import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Op, WhereOptions } from 'sequelize';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BitacoraService } from '../common/bitacora.service';
import { ROL_ADMINISTRADOR, ROLES, Usuario as UsuarioDecorador, type UsuarioActual } from '../common/usuario-actual';
import { Bitacora } from '../database/models/personal.models';
import { Usuario } from '../database/models/usuario.model';

const CLAVES_ROL = ROLES.map((r) => r.clave);

class CrearUsuarioDto {
  @Matches(/^[A-Za-z0-9._-]{3,20}$/, { message: 'El usuario son de 3 a 20 letras, números, punto o guion' }) usuario: string;
  @IsString() @MaxLength(120) nombre: string;
  @IsIn(CLAVES_ROL) rol: string;
  @IsString() @MinLength(8) password: string;
}

class EditarUsuarioDto {
  @IsOptional() @IsString() @MaxLength(120) nombre?: string;
  @IsOptional() @IsIn(CLAVES_ROL) rol?: string;
  @IsOptional() @IsBoolean() activo?: boolean;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

@Injectable()
export class UsuariosService {
  constructor(
    private readonly bitacora: BitacoraService,
    @InjectModel(Usuario) private readonly usuarios: typeof Usuario,
    @InjectModel(Bitacora) private readonly registros: typeof Bitacora,
  ) {}

  async listar() {
    const filas = await this.usuarios.findAll({ order: [['usuario', 'ASC']] });
    return { roles: ROLES, usuarios: filas.map((u) => vista(u)) };
  }

  async crear(dto: CrearUsuarioDto, quien: string) {
    const usuario = dto.usuario.toUpperCase();
    if (await this.usuarios.findOne({ where: { usuario } })) throw new ConflictException('Ese usuario ya existe.');
    const creado = await this.usuarios.create({ usuario, nombre: dto.nombre, rol: dto.rol, activo: true, passwordHash: await bcrypt.hash(dto.password, 10) });
    await this.bitacora.registrar({ usuario: quien, entidad: 'usuario', entidadId: usuario, accion: 'alta', despues: { rol: dto.rol } });
    return vista(creado);
  }

  async editar(id: number, dto: EditarUsuarioDto, quien: UsuarioActual) {
    const cuenta = await this.usuarios.findByPk(id);
    if (!cuenta) throw new NotFoundException('El usuario no existe');
    if (cuenta.id === quien.sub && (dto.activo === false || (dto.rol && dto.rol !== ROL_ADMINISTRADOR))) {
      throw new BadRequestException('No puedes quitarte el acceso de administrador a ti mismo.');
    }
    const { password, ...resto } = dto;
    await cuenta.update({ ...resto, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) });
    await this.bitacora.registrar({ usuario: quien.usuario, entidad: 'usuario', entidadId: cuenta.usuario, accion: 'cambio', despues: { ...resto, password: password ? 'cambiada' : undefined } });
    return vista(cuenta);
  }

  async bitacoraListar(filtro: { entidad?: string; usuario?: string; desde?: number }) {
    const where: WhereOptions<Bitacora> = {};
    if (filtro.entidad) Object.assign(where, { entidad: { [Op.iLike]: `${filtro.entidad}%` } });
    if (filtro.usuario) Object.assign(where, { usuario: filtro.usuario.toUpperCase() });
    const filas = await this.registros.findAll({ where, order: [['id', 'DESC']], limit: 100, offset: filtro.desde ?? 0 });
    return filas.map((b) => ({ id: b.id, usuario: b.usuario, entidad: b.entidad, entidadId: b.entidadId, accion: b.accion, antes: b.antes, despues: b.despues, fecha: b.createdAt }));
  }
}

const vista = (u: Usuario) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo, ultimoAcceso: u.ultimoAcceso });

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROL_ADMINISTRADOR)
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get('usuarios')
  listar() {
    return this.usuarios.listar();
  }

  @Post('usuarios')
  crear(@Body() dto: CrearUsuarioDto, @UsuarioDecorador() u: UsuarioActual) {
    return this.usuarios.crear(dto, u.usuario);
  }

  @Patch('usuarios/:id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: EditarUsuarioDto, @UsuarioDecorador() u: UsuarioActual) {
    return this.usuarios.editar(id, dto, u);
  }

  @Get('bitacora')
  bitacora(@Query('entidad') entidad?: string, @Query('usuario') usuario?: string, @Query('desde') desde?: string) {
    return this.usuarios.bitacoraListar({ entidad, usuario, desde: Number(desde) || 0 });
  }
}

@Module({
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
