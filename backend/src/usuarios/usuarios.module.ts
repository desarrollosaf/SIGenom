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
import { Op, QueryTypes } from 'sequelize';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BitacoraService } from '../common/bitacora.service';
import { patron } from '../common/busqueda';
import { nombreQuincena } from '../common/fechas';
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

  /**
   * La bitácora con la persona, la clave y la quincena escritas, no solo sus números internos.
   * `q` busca por nombre o CURP de la persona a la que se le hizo el movimiento.
   */
  async bitacoraListar(filtro: { entidad?: string; usuario?: string; q?: string; dia?: string; desde?: number }) {
    const db = this.registros.sequelize!;
    const q = filtro.q?.trim();
    const replacements = {
      entidad: filtro.entidad ? `${filtro.entidad}%` : null,
      usuario: filtro.usuario?.trim() ? filtro.usuario.trim().toUpperCase() : null,
      q: q || null,
      patron: q ? patron(q) : '',
      dia: filtro.dia && /^\d{4}-\d{2}-\d{2}$/.test(filtro.dia) ? filtro.dia : null,
      desde: filtro.desde ?? 0,
    };
    const numero = (texto: string) => `CASE WHEN ${texto} ~ '^[0-9]{1,9}$' THEN (${texto})::int END`;
    const empleado = `coalesce(CASE WHEN b.entidad = 'empleado' THEN ${numero('b.entidad_id')} END, ${numero("b.despues->>'empleadoId'")}, ${numero("b.antes->>'empleadoId'")})`;
    const periodo = `coalesce(CASE WHEN b.entidad = 'periodo' THEN ${numero('b.entidad_id')} END, ${numero("b.despues->>'periodoId'")}, ${numero("b.antes->>'periodoId'")})`;
    const concepto = `coalesce(${numero("b.despues->>'conceptoId'")}, ${numero("b.antes->>'conceptoId'")})`;
    const filas = await db.query<{
      id: number; usuario: string; entidad: string; entidad_id: string | null; accion: string; antes: Record<string, unknown> | null;
      despues: Record<string, unknown> | null; created_at: Date; persona: string | null; clave: number | null; concepto: string | null;
      tipo_nomina: string | null; anio: number | null; quincena: number | null;
    }>(
      `SELECT b.id, b.usuario, b.entidad, b.entidad_id, b.accion, b.antes, b.despues, b.created_at,
              nullif(concat_ws(' ', e.apellido_paterno, e.apellido_materno, e.nombres), '') persona,
              k.clave, k.descripcion concepto, p.tipo_nomina, p.anio, p.quincena
       FROM bitacora b
       LEFT JOIN empleados e ON e.id = ${empleado}
       LEFT JOIN periodos p ON p.id = ${periodo}
       LEFT JOIN conceptos k ON k.id = ${concepto}
       WHERE (CAST(:entidad AS text) IS NULL OR b.entidad ILIKE :entidad)
         AND (CAST(:usuario AS text) IS NULL OR b.usuario = :usuario)
         AND (CAST(:dia AS date) IS NULL OR (b.created_at AT TIME ZONE 'America/Mexico_City')::date = :dia)
         AND (CAST(:q AS text) IS NULL OR e.curp ILIKE :patron
              OR sin_acentos(concat_ws(' ', e.apellido_paterno, e.apellido_materno, e.nombres)) LIKE :patron)
       ORDER BY b.id DESC LIMIT 100 OFFSET :desde`,
      { type: QueryTypes.SELECT, replacements },
    );
    return filas.map((b) => ({
      id: b.id,
      usuario: b.usuario,
      entidad: b.entidad,
      entidadId: b.entidad_id,
      accion: b.accion,
      antes: b.antes,
      despues: b.despues,
      fecha: b.created_at,
      persona: b.persona,
      clave: b.clave === null ? null : `${String(b.clave).padStart(3, '0')} ${b.concepto}`,
      quincena: b.quincena === null || b.anio === null ? null : `${b.tipo_nomina} · ${nombreQuincena(b.anio, b.quincena)}`,
    }));
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
  bitacora(
    @Query('entidad') entidad?: string,
    @Query('usuario') usuario?: string,
    @Query('q') q?: string,
    @Query('dia') dia?: string,
    @Query('desde') desde?: string,
  ) {
    return this.usuarios.bitacoraListar({ entidad, usuario, q, dia, desde: Math.max(0, Number(desde) || 0) });
  }
}

@Module({
  controllers: [UsuariosController],
  providers: [UsuariosService],
})
export class UsuariosModule {}
