import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { Motivo } from '../database/models/catalogos.models';
import { Empleado, MovimientoPersonal } from '../database/models/personal.models';
import { BajaDto, PermisoDto, ReingresoDto } from './dto/empleado.dto';

/**
 * Bajas, permisos, reingresos y su cancelación. En el sistema anterior eran 1MOT-BAJ.W, 1RE-PERM.W,
 * 1CANC-BA.W y 1CANC-PE.W, y la baja borraba al empleado de la tabla Empleado para copiarlo a
 * H-bajas. Aquí el empleado se queda y solo cambia su estado: el historial no se pierde.
 */
@Injectable()
export class MovimientosService {
  constructor(
    private readonly bitacora: BitacoraService,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
    @InjectModel(MovimientoPersonal) private readonly movimientos: typeof MovimientoPersonal,
    @InjectModel(Motivo) private readonly motivos: typeof Motivo,
  ) {}

  async listar(filtro: { tipo?: string; desde?: string; hasta?: string; tipoNomina?: string }) {
    const where: WhereOptions<MovimientoPersonal> = {};
    if (filtro.tipo) Object.assign(where, { tipo: filtro.tipo });
    if (filtro.desde || filtro.hasta) {
      Object.assign(where, {
        fechaInicio: {
          ...(filtro.desde ? { [Op.gte]: filtro.desde } : {}),
          ...(filtro.hasta ? { [Op.lte]: filtro.hasta } : {}),
        },
      });
    }
    const filas = await this.movimientos.findAll({
      where,
      include: [
        { model: Empleado, where: filtro.tipoNomina ? { tipoNomina: filtro.tipoNomina } : undefined },
        Motivo,
      ],
      order: [['fechaInicio', 'DESC'], ['id', 'DESC']],
      limit: 500,
    });
    return filas.map((m) => ({
      id: m.id,
      empleadoId: m.empleadoId,
      nombre: m.empleado.nombreCompleto,
      curp: m.empleado.curp,
      tipo: m.tipo,
      motivo: m.motivo?.descripcion ?? null,
      fechaInicio: m.fechaInicio,
      fechaFin: m.fechaFin,
      observaciones: m.observaciones,
      cancelado: m.cancelado,
      registradoPor: m.registradoPor,
    }));
  }

  async baja(empleadoId: number, dto: BajaDto, usuario: string) {
    const empleado = await this.empleado(empleadoId);
    if (empleado.estado === 'baja') throw new BadRequestException('El empleado ya está dado de baja.');
    if (dto.fecha < empleado.fechaAlta) throw new BadRequestException('La baja no puede ser antes del alta.');
    await this.motivo(dto.motivoClave, 'B');
    await this.empleados.sequelize!.transaction(async (transaction) => {
      await this.movimientos.create(
        { empleadoId, tipo: 'baja', motivoClave: dto.motivoClave, fechaInicio: dto.fecha, observaciones: dto.observaciones ?? null, registradoPor: usuario, cancelado: false },
        { transaction },
      );
      await empleado.update({ estado: 'baja', fechaBaja: dto.fecha }, { transaction });
      await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: empleadoId, accion: 'baja', despues: { ...dto } }, transaction);
    });
  }

  async permiso(empleadoId: number, dto: PermisoDto, usuario: string) {
    const empleado = await this.empleado(empleadoId);
    if (empleado.estado === 'baja') throw new BadRequestException('El empleado está dado de baja.');
    if (dto.fin && dto.fin < dto.inicio) throw new BadRequestException('El permiso termina antes de empezar.');
    await this.motivo(dto.motivoClave, 'P');
    const encimado = await this.movimientos.findOne({
      where: {
        empleadoId,
        tipo: 'permiso',
        cancelado: false,
        fechaInicio: { [Op.lte]: dto.fin ?? '9999-12-31' },
        [Op.or]: [{ fechaFin: null }, { fechaFin: { [Op.gte]: dto.inicio } }],
      },
    });
    if (encimado) throw new BadRequestException('Ya tiene un permiso en esas fechas.');
    await this.empleados.sequelize!.transaction(async (transaction) => {
      await this.movimientos.create(
        { empleadoId, tipo: 'permiso', motivoClave: dto.motivoClave, fechaInicio: dto.inicio, fechaFin: dto.fin ?? null, observaciones: dto.observaciones ?? null, registradoPor: usuario, cancelado: false },
        { transaction },
      );
      // Un permiso que empieza hoy o antes suspende ya; uno futuro solo descuenta sus días al calcular.
      const hoy = new Date().toISOString().slice(0, 10);
      if (dto.inicio <= hoy && (!dto.fin || dto.fin >= hoy)) {
        await empleado.update({ estado: 'permiso' }, { transaction });
      }
      await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: empleadoId, accion: 'permiso', despues: { ...dto } }, transaction);
    });
  }

  async reingreso(empleadoId: number, dto: ReingresoDto, usuario: string) {
    const empleado = await this.empleado(empleadoId);
    if (empleado.estado === 'activo') throw new BadRequestException('El empleado ya está activo.');
    await this.empleados.sequelize!.transaction(async (transaction) => {
      if (empleado.estado === 'permiso') {
        // Termina el permiso abierto el día anterior al reingreso.
        const abierto = await this.movimientos.findOne({
          where: { empleadoId, tipo: 'permiso', cancelado: false, [Op.or]: [{ fechaFin: null }, { fechaFin: { [Op.gte]: dto.fecha } }] },
          order: [['fechaInicio', 'DESC']],
          transaction,
        });
        const diaAnterior = new Date(Date.parse(`${dto.fecha}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        await abierto?.update({ fechaFin: diaAnterior }, { transaction });
      }
      await this.movimientos.create(
        { empleadoId, tipo: 'reingreso', fechaInicio: dto.fecha, observaciones: dto.observaciones ?? null, registradoPor: usuario, cancelado: false },
        { transaction },
      );
      await empleado.update(
        empleado.estado === 'baja' ? { estado: 'activo', fechaAlta: dto.fecha, fechaBaja: null } : { estado: 'activo' },
        { transaction },
      );
      await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: empleadoId, accion: 'reingreso', despues: { ...dto } }, transaction);
    });
  }

  /** Cancela una baja o un permiso ya aplicado y regresa al empleado a como estaba. */
  async cancelar(id: number, usuario: string) {
    const movimiento = await this.movimientos.findByPk(id, { include: [Empleado] });
    if (!movimiento) throw new NotFoundException('El movimiento no existe');
    if (movimiento.cancelado) throw new BadRequestException('El movimiento ya estaba cancelado.');
    if (!['baja', 'permiso'].includes(movimiento.tipo)) {
      throw new BadRequestException('Solo se cancelan bajas y permisos.');
    }
    const empleado = movimiento.empleado;
    await this.empleados.sequelize!.transaction(async (transaction) => {
      await movimiento.update({ cancelado: true, canceladoPor: usuario }, { transaction });
      if (movimiento.tipo === 'baja' && empleado.estado === 'baja') {
        await empleado.update({ estado: 'activo', fechaBaja: null }, { transaction });
      }
      if (movimiento.tipo === 'permiso' && empleado.estado === 'permiso') {
        await empleado.update({ estado: 'activo' }, { transaction });
      }
      await this.bitacora.registrar(
        { usuario, entidad: 'empleado', entidadId: empleado.id, accion: `cancela_${movimiento.tipo}`, antes: { movimiento: id } },
        transaction,
      );
    });
  }

  private async empleado(id: number) {
    const empleado = await this.empleados.findByPk(id);
    if (!empleado) throw new NotFoundException('El empleado no existe');
    return empleado;
  }

  private async motivo(clave: string, aplica: 'B' | 'P') {
    const motivo = await this.motivos.findByPk(clave);
    if (!motivo || !motivo.activo || motivo.aplica !== aplica) {
      throw new BadRequestException(`El motivo no es válido para ${aplica === 'B' ? 'una baja' : 'un permiso'}.`);
    }
  }
}
