import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { Concepto } from '../database/models/catalogos.models';
import { Captura } from '../database/models/nomina.models';
import { Empleado } from '../database/models/personal.models';
import { PeriodosService } from './periodos.service';

/** De dónde puede venir un movimiento de la quincena. Cada uno era un "traspaso" en el sistema anterior. */
export const ORIGENES = {
  captura: 'Captura manual',
  inasistencias: 'Inasistencias y premio de puntualidad (1TRA-I-P)',
  reintegros: 'Reintegros por justificación (1TRA-REI)',
  caja: 'Caja de ahorro (1TRA-D-C)',
  comedor: 'Comedor',
  otro: 'Otro archivo',
} as const;

export type Origen = keyof typeof ORIGENES;

@Injectable()
export class CapturasService {
  constructor(
    private readonly periodos: PeriodosService,
    private readonly bitacora: BitacoraService,
    @InjectModel(Captura) private readonly capturas: typeof Captura,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
  ) {}

  async listar(periodoId: number, empleadoId?: number) {
    const filas = await this.capturas.findAll({
      where: { periodoId, ...(empleadoId ? { empleadoId } : {}) },
      include: [Empleado, Concepto],
      order: [['id', 'DESC']],
      limit: 2000,
    });
    return filas.map((c) => ({
      id: c.id,
      empleadoId: c.empleadoId,
      nombre: c.empleado.nombreCompleto,
      curp: c.empleado.curp,
      conceptoId: c.conceptoId,
      clave: c.concepto.clave,
      concepto: c.concepto.descripcion,
      naturaleza: c.concepto.naturaleza,
      importe: c.importe,
      origen: c.origen,
      referencia: c.referencia,
      registradoPor: c.registradoPor,
      creadoEl: c.createdAt,
    }));
  }

  async crear(
    periodoId: number,
    datos: { empleadoId: number; conceptoId: number; importe: number; referencia?: string },
    usuario: string,
  ) {
    const periodo = await this.periodos.abierto(periodoId);
    const empleado = await this.empleados.findByPk(datos.empleadoId);
    if (!empleado || empleado.tipoNomina !== periodo.tipoNomina) {
      throw new BadRequestException('El empleado no pertenece a esta nómina.');
    }
    const concepto = await this.conceptos.findByPk(datos.conceptoId);
    if (!concepto || concepto.tipoNomina !== periodo.tipoNomina || !concepto.activo) {
      throw new BadRequestException('La clave no pertenece a esta nómina.');
    }
    if (concepto.calculado) throw new BadRequestException(`${concepto.descripcion} lo calcula el sistema.`);
    const captura = await this.capturas.create({
      periodoId,
      ...datos,
      referencia: datos.referencia ?? null,
      origen: 'captura',
      registradoPor: usuario,
    });
    await this.bitacora.registrar({ usuario, entidad: 'captura', entidadId: captura.id, accion: 'alta', despues: { periodoId, ...datos } });
    return { id: captura.id };
  }

  async eliminar(id: number, usuario: string) {
    const captura = await this.capturas.findByPk(id);
    if (!captura) throw new NotFoundException('La captura ya no existe');
    await this.periodos.abierto(captura.periodoId);
    await captura.destroy();
    await this.bitacora.registrar({ usuario, entidad: 'captura', entidadId: id, accion: 'baja', antes: captura.get({ plain: true }) });
  }

  /**
   * Importa un CSV "curp,clave,importe[,referencia]". Lo que no se pueda aplicar se informa por
   * renglón y no detiene a los demás; nada se guarda si el archivo no trae ningún renglón válido.
   */
  async importar(periodoId: number, contenido: string, origen: Origen, usuario: string) {
    const periodo = await this.periodos.abierto(periodoId);
    if (!ORIGENES[origen]) throw new BadRequestException('Origen no válido.');

    const [empleados, conceptos] = await Promise.all([
      this.empleados.findAll({ where: { tipoNomina: periodo.tipoNomina }, attributes: ['id', 'curp', 'estado'] }),
      this.conceptos.findAll({ where: { tipoNomina: periodo.tipoNomina, activo: true } }),
    ]);
    const porCurp = new Map(empleados.map((e) => [e.curp, e]));
    const porClave = new Map(conceptos.map((c) => [c.clave, c]));

    const validas: { periodoId: number; empleadoId: number; conceptoId: number; importe: number; referencia: string | null; origen: string; registradoPor: string }[] = [];
    const errores: { renglon: number; texto: string; error: string }[] = [];

    contenido.split(/\r?\n/).forEach((linea, i) => {
      const texto = linea.trim();
      if (!texto) return;
      const [curp, clave, importe, referencia] = texto.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
      if (i === 0 && !/^\d/.test(clave ?? '')) return; // encabezado
      const empleado = porCurp.get((curp ?? '').toUpperCase());
      const concepto = porClave.get(Number(clave));
      const monto = Number(String(importe ?? '').replace(/[$\s,]/g, ''));
      const error = !empleado
        ? 'CURP no encontrada en esta nómina'
        : !concepto
          ? 'Clave no existe en esta nómina'
          : concepto.calculado
            ? 'Esa clave la calcula el sistema'
            : !Number.isFinite(monto) || monto === 0
              ? 'Importe no válido'
              : null;
      if (error) errores.push({ renglon: i + 1, texto, error });
      else validas.push({ periodoId, empleadoId: empleado!.id, conceptoId: concepto!.id, importe: Math.round(monto * 100) / 100, referencia: referencia || null, origen, registradoPor: usuario });
    });

    if (validas.length) {
      await this.capturas.bulkCreate(validas);
      await this.bitacora.registrar({ usuario, entidad: 'periodo', entidadId: periodoId, accion: `importa_${origen}`, despues: { renglones: validas.length, errores: errores.length } });
    }
    return { importadas: validas.length, errores };
  }
}
