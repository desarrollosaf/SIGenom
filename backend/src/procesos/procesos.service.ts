import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { hoyMexico } from '../common/fechas';
import { TablasService } from '../common/tablas.service';
import { Tabulador } from '../database/models/catalogos.models';
import { Empleado } from '../database/models/personal.models';
import { calcularRecibo } from '../motor/motor';

export interface AumentoSalarial {
  porcentaje: number;
  /** Niveles a los que aplica; vacío = todos. */
  niveles?: number[];
  incluirCompensacion?: boolean;
}

@Injectable()
export class ProcesosService {
  constructor(
    private readonly tablas: TablasService,
    private readonly bitacora: BitacoraService,
    @InjectModel(Tabulador) private readonly tabulador: typeof Tabulador,
    @InjectModel(Empleado) private readonly empleados: typeof Empleado,
  ) {}

  /**
   * Aumento salarial general (1CAL-A-S.W). El original cambiaba el importe en cada empleado; aquí se
   * cambia el tabulador y todos los que tengan ese nivel y rango lo reciben en el siguiente cálculo.
   */
  async vistaPrevia(datos: AumentoSalarial) {
    const filas = await this.filasAumento(datos);
    const empleados = await this.empleados.count({
      where: { estado: { [Op.ne]: 'baja' }, ...(datos.niveles?.length ? { nivel: datos.niveles } : {}) },
    });
    const renglones = filas.map((t) => ({
      id: t.id,
      nivel: t.nivel,
      rango: t.rango,
      sueldoAntes: t.sueldoMensual,
      sueldoDespues: aumentar(t.sueldoMensual, datos.porcentaje),
      compensacionAntes: t.compensacionMensual,
      compensacionDespues: datos.incluirCompensacion ? aumentar(t.compensacionMensual, datos.porcentaje) : t.compensacionMensual,
    }));
    return { renglones, empleados };
  }

  async aplicarAumento(datos: AumentoSalarial, usuario: string) {
    const filas = await this.filasAumento(datos);
    await this.tabulador.sequelize!.transaction(async (transaction) => {
      for (const t of filas) {
        await t.update(
          {
            sueldoMensual: aumentar(t.sueldoMensual, datos.porcentaje),
            ...(datos.incluirCompensacion ? { compensacionMensual: aumentar(t.compensacionMensual, datos.porcentaje) } : {}),
          },
          { transaction },
        );
      }
      await this.bitacora.registrar(
        { usuario, entidad: 'tabulador', accion: 'aumento_general', despues: { ...datos, renglones: filas.length } },
        transaction,
      );
    });
    return { actualizados: filas.length };
  }

  /**
   * Estimador de sueldo (1SLD-EST.W): cuánto recibiría alguien en un nivel y rango, con el mismo
   * motor que la nómina real, sin guardar nada.
   */
  async simular(datos: { tipoNomina: string; nivel: number; rango: number; dias?: number; fijos?: { conceptoId: number; importe: number }[] }) {
    const tab = await this.tabulador.findOne({ where: { nivel: datos.nivel, rango: datos.rango } });
    if (!tab) throw new BadRequestException('Ese nivel y rango no están en el tabulador.');
    const tablas = await this.tablas.paraNomina(datos.tipoNomina, hoyMexico());
    return calcularRecibo(
      {
        empleadoId: 0,
        sueldoMensual: tab.sueldoMensual,
        compensacionMensual: tab.compensacionMensual,
        dias: datos.dias ?? tablas.parametros.diasQuincena,
        fijos: datos.fijos ?? [],
        capturas: [],
        descuentosPlazo: [],
      },
      tablas,
    );
  }

  private async filasAumento(datos: AumentoSalarial) {
    if (!(datos.porcentaje > 0 && datos.porcentaje <= 100)) throw new BadRequestException('El porcentaje va de 0 a 100.');
    return this.tabulador.findAll({
      where: datos.niveles?.length ? { nivel: datos.niveles } : {},
      order: [['nivel', 'ASC'], ['rango', 'ASC']],
    });
  }
}

const aumentar = (importe: number, porcentaje: number) => Math.round(importe * (1 + porcentaje / 100) * 100) / 100;
