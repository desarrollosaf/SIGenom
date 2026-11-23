import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { BitacoraService } from '../common/bitacora.service';
import { capacidades, UsuarioActual } from '../common/usuario-actual';
import { Usuario } from '../database/models/usuario.model';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Usuario) private readonly usuarios: typeof Usuario,
    private readonly jwt: JwtService,
    private readonly bitacora: BitacoraService,
  ) {}

  async login(usuario: string, password: string) {
    const cuenta = await this.usuarios.findOne({ where: { usuario: usuario.trim().toUpperCase() } });
    if (!cuenta || !cuenta.activo || !(await bcrypt.compare(password, cuenta.passwordHash))) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    await cuenta.update({ ultimoAcceso: new Date() });

    const payload: UsuarioActual = { sub: cuenta.id, usuario: cuenta.usuario, rol: cuenta.rol };
    return { access_token: await this.jwt.signAsync(payload), user: this.vista(cuenta) };
  }

  async yo(actual: UsuarioActual) {
    const cuenta = await this.usuarios.findByPk(actual.sub);
    if (!cuenta || !cuenta.activo) throw new UnauthorizedException('Tu cuenta ya no está activa');
    return this.vista(cuenta);
  }

  async cambiarContrasena(actual: UsuarioActual, anterior: string, nueva: string) {
    const cuenta = await this.usuarios.findByPk(actual.sub);
    if (!cuenta || !(await bcrypt.compare(anterior, cuenta.passwordHash))) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }
    await cuenta.update({ passwordHash: await bcrypt.hash(nueva, 10) });
    await this.bitacora.registrar({ usuario: cuenta.usuario, entidad: 'usuario', entidadId: cuenta.usuario, accion: 'cambia_contrasena' });
  }

  private vista(cuenta: Usuario) {
    return {
      id: cuenta.id,
      usuario: cuenta.usuario,
      nombre: cuenta.nombre,
      rol: cuenta.rol,
      capacidades: capacidades(cuenta.rol),
    };
  }
}
