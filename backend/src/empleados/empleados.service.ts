import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Sequelize, WhereOptions } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { contiene, patron } from '../common/busqueda';
import { Adscripcion, Concepto, Motivo, Puesto, Tabulador } from '../database/models/catalogos.models';
import { Recibo, Calculo, Periodo } from '../database/models/nomina.models';
import {
  CuentaContable,
  DatosPersonales,
  DescuentoPlazo,
  Empleado,
  EmpleadoConcepto,
  MovimientoPersonal,
  SucursalBancaria,
} from '../database/models/personal.models';
import {
  ActualizarEmpleadoDto,
  CrearEmpleadoDto,
  CuentaContableDto,
  DescuentoPlazoDto,
  FiltroEmpleadosDto,
} from './dto/empleado.dto';

/** Campos de la tabla empleados que se pueden editar desde la ficha. */
const EDITABLES = [
  'rfc',
  'apellidoPaterno',
  'apellidoMaterno',
  'nombres',
  'adscripcionId',
  'puestoClave',
  'nivel',
  'rango',
  'numeroIssemym',
  'sindicalizado',
  'sci',
  'fechaIngresoGobierno',
  'fechaNacimiento',
  'codigoPostalFiscal',
  'banco',
  'cuentaBancaria',
  'pagoCheque',
] as const;

@Injectable()
export class EmpleadosService {
  constructor(
    private readonly bitacora: BitacoraService,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
    @InjectModel(DatosPersonales) private readonly datos: typeof DatosPersonales,
    @InjectModel(EmpleadoConcepto) private readonly fijos: typeof EmpleadoConcepto,
    @InjectModel(DescuentoPlazo) private readonly plazos: typeof DescuentoPlazo,
    @InjectModel(CuentaContable) private readonly cuentas: typeof CuentaContable,
    @InjectModel(SucursalBancaria) private readonly sucursales: typeof SucursalBancaria,
    @InjectModel(MovimientoPersonal) private readonly movimientos: typeof MovimientoPersonal,
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
    @InjectModel(Tabulador) private readonly tabulador: typeof Tabulador,
    @InjectModel(Recibo) private readonly recibos: typeof Recibo,
  ) {}

  async listar(filtro: FiltroEmpleadosDto) {
    const where: WhereOptions<Empleado> = {};
    if (filtro.tipoNomina) Object.assign(where, { tipoNomina: filtro.tipoNomina });
    if (filtro.estado && filtro.estado !== 'todos') Object.assign(where, { estado: filtro.estado });
    else if (!filtro.estado) Object.assign(where, { estado: { [Op.ne]: 'baja' } });
    if (filtro.adscripcionId) Object.assign(where, { adscripcionId: filtro.adscripcionId });
    const q = filtro.q?.trim();
    if (q) {
      Object.assign(where, {
        [Op.or]: [
          { curp: { [Op.iLike]: patron(q) } },
          { rfc: { [Op.iLike]: patron(q) } },
          contiene(
            Sequelize.fn(
              'concat_ws',
              ' ',
              Sequelize.col('apellido_paterno'),
              Sequelize.col('apellido_materno'),
              Sequelize.col('nombres'),
            ),
            q,
          ),
        ],
      });
    }
    const limite = Math.min(filtro.limite ?? 50, 200);
    const { rows, count } = await this.empleados.findAndCountAll({
      where,
      include: [Adscripcion, Puesto],
      order: [['apellidoPaterno', 'ASC'], ['apellidoMaterno', 'ASC'], ['nombres', 'ASC']],
      limit: limite,
      offset: filtro.desde ?? 0,
    });
    return { total: count, empleados: rows.map((e) => this.resumen(e)) };
  }

  async ficha(id: number) {
    const empleado = await this.empleados.findByPk(id, {
      include: [
        Adscripcion,
        Puesto,
        DatosPersonales,
        SucursalBancaria,
        { model: EmpleadoConcepto, include: [Concepto] },
        { model: DescuentoPlazo, include: [Concepto] },
        { model: CuentaContable, include: [Concepto] },
      ],
    });
    if (!empleado) throw new NotFoundException('El empleado no existe');

    const [tab, movimientos, recibos] = await Promise.all([
      this.tabulador.findOne({ where: { nivel: empleado.nivel, rango: empleado.rango } }),
      this.movimientos.findAll({
        where: { empleadoId: id },
        include: [Motivo],
        order: [['fechaInicio', 'DESC'], ['id', 'DESC']],
      }),
      this.recibos.findAll({
        where: { empleadoId: id },
        include: [{ model: Calculo, where: { estado: 'terminado' }, include: [Periodo] }],
        order: [['id', 'DESC']],
        limit: 24,
      }),
    ]);

    const concepto = (c: Concepto) => ({ id: c.id, clave: c.clave, nombre: c.descripcion, naturaleza: c.naturaleza });
    return {
      ...this.resumen(empleado),
      datosPersonales: empleado.datosPersonales ?? null,
      tabulador: tab ? { sueldoMensual: tab.sueldoMensual, compensacionMensual: tab.compensacionMensual } : null,
      sucursal: empleado.sucursal ? { sucursal: empleado.sucursal.sucursal, tipo: empleado.sucursal.tipo } : null,
      fijos: empleado.conceptosFijos
        .map((f) => ({ id: f.id, importe: f.importe, concepto: concepto(f.concepto) }))
        .sort((a, b) => b.concepto.naturaleza.localeCompare(a.concepto.naturaleza) || a.concepto.clave - b.concepto.clave),
      descuentosPlazo: empleado.descuentosPlazo.map((d) => ({
        id: d.id,
        importeQuincenal: d.importeQuincenal,
        porcentaje: d.porcentaje,
        quincenasPendientes: d.quincenasPendientes,
        beneficiario: d.beneficiario,
        activo: d.activo,
        concepto: concepto(d.concepto),
      })),
      cuentasContables: empleado.cuentasContables.map((c) => ({ id: c.id, partida: c.partida, concepto: concepto(c.concepto) })),
      movimientos: movimientos.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        motivo: m.motivo?.descripcion ?? null,
        fechaInicio: m.fechaInicio,
        fechaFin: m.fechaFin,
        detalle: m.detalle,
        observaciones: m.observaciones,
        cancelado: m.cancelado,
        registradoPor: m.registradoPor,
      })),
      recibos: recibos.map((r) => ({
        id: r.id,
        tipo: r.calculo.tipo,
        anio: r.calculo.periodo.anio,
        quincena: r.calculo.periodo.quincena,
        totalPercepciones: r.totalPercepciones,
        totalDeducciones: r.totalDeducciones,
        neto: r.neto,
      })),
    };
  }

  async crear(dto: CrearEmpleadoDto, usuario: string) {
    const curp = dto.curp.toUpperCase();
    const existente = await this.empleados.findOne({ where: { curp, tipoNomina: dto.tipoNomina } });
    if (existente) {
      throw new ConflictException(
        existente.estado === 'baja'
          ? 'Esa CURP ya estuvo en esta nómina: regístrale un reingreso desde su ficha.'
          : 'Esa CURP ya está en esta nómina.',
      );
    }
    const { datosPersonales, ...campos } = dto;
    return this.empleados.sequelize!.transaction(async (transaction) => {
      const empleado = await this.empleados.create(
        { ...campos, curp, rfc: dto.rfc.toUpperCase(), estado: 'activo' },
        { transaction },
      );
      await this.datos.create({ empleadoId: empleado.id, ...(datosPersonales ?? {}) }, { transaction });
      await this.movimientos.create(
        {
          empleadoId: empleado.id,
          tipo: 'alta',
          fechaInicio: dto.fechaAlta,
          detalle: { puesto: dto.puestoClave, nivel: dto.nivel, rango: dto.rango, adscripcion: dto.adscripcionId },
          registradoPor: usuario,
          cancelado: false,
        },
        { transaction },
      );
      await this.bitacora.registrar(
        { usuario, entidad: 'empleado', entidadId: empleado.id, accion: 'alta', despues: { curp, nombre: empleado.nombreCompleto } },
        transaction,
      );
      return { id: empleado.id };
    });
  }

  async actualizar(id: number, dto: ActualizarEmpleadoDto, usuario: string) {
    const empleado = await this.buscar(id);
    const cambios: Record<string, unknown> = {};
    for (const campo of EDITABLES) {
      if (dto[campo] !== undefined) cambios[campo] = dto[campo];
    }
    if (typeof cambios['rfc'] === 'string') cambios['rfc'] = (cambios['rfc'] as string).toUpperCase();

    await this.empleados.sequelize!.transaction(async (transaction) => {
      const antes = empleado.get({ plain: true }) as Record<string, unknown>;
      await empleado.update(cambios, { transaction });
      const diferencia = BitacoraService.diferencias(antes, cambios);

      // Cambio de puesto, nivel o adscripción: también es un movimiento de personal (FUM).
      const laborales = ['puestoClave', 'nivel', 'rango', 'adscripcionId'].filter(
        (c) => diferencia?.despues[c] !== undefined,
      );
      if (laborales.length) {
        await this.movimientos.create(
          {
            empleadoId: id,
            tipo: 'cambio',
            fechaInicio: new Date().toISOString().slice(0, 10),
            detalle: Object.fromEntries(laborales.map((c) => [c, { antes: antes[c], despues: cambios[c] }])),
            registradoPor: usuario,
            cancelado: false,
          },
          { transaction },
        );
      }
      if (dto.datosPersonales) {
        const [datos] = await this.datos.findOrCreate({ where: { empleadoId: id }, transaction });
        await datos.update(dto.datosPersonales, { transaction });
      }
      if (diferencia) {
        await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'cambio', ...diferencia }, transaction);
      }
    });
    return this.ficha(id);
  }

  /** Cambio de CURP (1CAM-CUR.W): queda en la bitácora con la anterior. */
  async cambiarCurp(id: number, curp: string, usuario: string) {
    const empleado = await this.buscar(id);
    const nueva = curp.toUpperCase();
    if (await this.empleados.findOne({ where: { curp: nueva, tipoNomina: empleado.tipoNomina, id: { [Op.ne]: id } } })) {
      throw new ConflictException('Esa CURP ya la tiene otra persona en esta nómina.');
    }
    const anterior = empleado.curp;
    await empleado.update({ curp: nueva });
    await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'cambio_curp', antes: { curp: anterior }, despues: { curp: nueva } });
  }

  // --- Percepciones y deducciones fijas ----------------------------------------------------------

  async fijarConcepto(id: number, conceptoId: number, importe: number, usuario: string) {
    const empleado = await this.buscar(id);
    const concepto = await this.conceptoDe(empleado, conceptoId);
    if (concepto.calculado) throw new BadRequestException(`${concepto.descripcion} lo calcula el sistema.`);
    const [fijo, creado] = await this.fijos.findOrCreate({
      where: { empleadoId: id, conceptoId },
      defaults: { empleadoId: id, conceptoId, importe },
    });
    const anterior = creado ? null : fijo.importe;
    if (!creado) await fijo.update({ importe });
    await this.bitacora.registrar({
      usuario,
      entidad: 'empleado',
      entidadId: id,
      accion: 'concepto_fijo',
      antes: anterior === null ? null : { clave: concepto.clave, importe: anterior },
      despues: { clave: concepto.clave, importe },
    });
  }

  async quitarConcepto(id: number, conceptoId: number, usuario: string) {
    const fijo = await this.fijos.findOne({ where: { empleadoId: id, conceptoId }, include: [Concepto] });
    if (!fijo) throw new NotFoundException('Ese concepto no está asignado');
    await fijo.destroy();
    await this.bitacora.registrar({
      usuario,
      entidad: 'empleado',
      entidadId: id,
      accion: 'concepto_fijo',
      antes: { clave: fijo.concepto.clave, importe: fijo.importe },
    });
  }

  // --- Descuentos a plazo y pensiones (1ABC-PEN.W) -----------------------------------------------

  async guardarDescuento(id: number, dto: DescuentoPlazoDto, descuentoId: number | null, usuario: string) {
    const empleado = await this.buscar(id);
    const concepto = await this.conceptoDe(empleado, dto.conceptoId);
    if (concepto.naturaleza !== 'D') throw new BadRequestException('Un descuento debe usar una clave de deducción.');
    const datos = { ...dto, empleadoId: id, activo: dto.activo ?? true };
    if (descuentoId) {
      const existente = await this.plazos.findOne({ where: { id: descuentoId, empleadoId: id } });
      if (!existente) throw new NotFoundException('El descuento ya no existe');
      await existente.update(datos);
    } else {
      await this.plazos.create(datos);
    }
    await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'descuento_plazo', despues: datos });
  }

  async quitarDescuento(id: number, descuentoId: number, usuario: string) {
    const existente = await this.plazos.findOne({ where: { id: descuentoId, empleadoId: id } });
    if (!existente) throw new NotFoundException('El descuento ya no existe');
    await existente.destroy();
    await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'descuento_plazo', antes: existente.get({ plain: true }) });
  }

  // --- Cuentas contables de préstamos y aportaciones (1ABC-PA.W) --------------------------------

  async guardarCuenta(id: number, dto: CuentaContableDto, usuario: string) {
    const empleado = await this.buscar(id);
    await this.conceptoDe(empleado, dto.conceptoId);
    const [cuenta, creada] = await this.cuentas.findOrCreate({
      where: { empleadoId: id, conceptoId: dto.conceptoId },
      defaults: { empleadoId: id, ...dto },
    });
    if (!creada) await cuenta.update({ partida: dto.partida });
    await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'cuenta_contable', despues: { ...dto } });
  }

  async quitarCuenta(id: number, cuentaId: number, usuario: string) {
    const cuenta = await this.cuentas.findOne({ where: { id: cuentaId, empleadoId: id } });
    if (!cuenta) throw new NotFoundException('La cuenta ya no existe');
    await cuenta.destroy();
    await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'cuenta_contable', antes: { conceptoId: cuenta.conceptoId, partida: cuenta.partida } });
  }

  /** Sucursal para cuentas bancarias que no son de Pagomático (1ABC-SUC.W). */
  async guardarSucursal(id: number, sucursal: number | null, tipo: string, usuario: string) {
    await this.buscar(id);
    const existente = await this.sucursales.findOne({ where: { empleadoId: id } });
    if (sucursal === null) await existente?.destroy();
    else if (existente) await existente.update({ sucursal, tipo });
    else await this.sucursales.create({ empleadoId: id, sucursal, tipo });
    await this.bitacora.registrar({ usuario, entidad: 'empleado', entidadId: id, accion: 'sucursal', despues: { sucursal, tipo } });
  }

  async buscar(id: number) {
    const empleado = await this.empleados.findByPk(id);
    if (!empleado) throw new NotFoundException('El empleado no existe');
    return empleado;
  }

  private async conceptoDe(empleado: Empleado, conceptoId: number) {
    const concepto = await this.conceptos.findByPk(conceptoId);
    if (!concepto || concepto.tipoNomina !== empleado.tipoNomina) {
      throw new BadRequestException('La clave no pertenece a la nómina del empleado.');
    }
    return concepto;
  }

  private resumen(e: Empleado) {
    return {
      id: e.id,
      curp: e.curp,
      rfc: e.rfc,
      nombre: e.nombreCompleto,
      apellidoPaterno: e.apellidoPaterno,
      apellidoMaterno: e.apellidoMaterno,
      nombres: e.nombres,
      tipoNomina: e.tipoNomina,
      adscripcionId: e.adscripcionId,
      adscripcion: e.adscripcion?.descripcion ?? null,
      puestoClave: e.puestoClave,
      puesto: e.puesto?.descripcion ?? null,
      nivel: e.nivel,
      rango: e.rango,
      numeroIssemym: e.numeroIssemym,
      sindicalizado: e.sindicalizado,
      sci: e.sci,
      estado: e.estado,
      fechaAlta: e.fechaAlta,
      fechaBaja: e.fechaBaja,
      fechaIngresoGobierno: e.fechaIngresoGobierno,
      fechaNacimiento: e.fechaNacimiento,
      codigoPostalFiscal: e.codigoPostalFiscal,
      banco: e.banco,
      cuentaBancaria: e.cuentaBancaria,
      pagoCheque: e.pagoCheque,
    };
  }
}
