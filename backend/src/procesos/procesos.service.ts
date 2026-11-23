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
  /** También a la compensación (011) y la gratificación (012). */
  incluirCompensacion?: boolean;
  /** Desde cuándo vale el tabulador nuevo; por omisión, hoy. */
  vigencia?: string;
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
   * crea una vigencia nueva del tabulador: las quincenas desde esa fecha usan los importes nuevos y
   * las anteriores conservan los suyos (queda la historia para auditoría y retroactivos).
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
      gratificacionAntes: t.gratificacionMensual,
      gratificacionDespues: datos.incluirCompensacion ? aumentar(t.gratificacionMensual, datos.porcentaje) : t.gratificacionMensual,
    }));
    return { vigencia: datos.vigencia ?? hoyMexico(), renglones, empleados };
  }

  async aplicarAumento(datos: AumentoSalarial, usuario: string) {
    const filas = await this.filasAumento(datos);
    const vigencia = datos.vigencia ?? hoyMexico();
    await this.tabulador.sequelize!.transaction(async (transaction) => {
      for (const t of filas) {
        const nuevo = {
          sueldoMensual: aumentar(t.sueldoMensual, datos.porcentaje),
          compensacionMensual: datos.incluirCompensacion ? aumentar(t.compensacionMensual, datos.porcentaje) : t.compensacionMensual,
          gratificacionMensual: datos.incluirCompensacion ? aumentar(t.gratificacionMensual, datos.porcentaje) : t.gratificacionMensual,
        };
        // Si ya había renglón con esa vigencia se corrige; si no, se agrega uno nuevo.
        if (t.vigencia === vigencia) await t.update(nuevo, { transaction });
        else await this.tabulador.create({ vigencia, nivel: t.nivel, rango: t.rango, ...nuevo }, { transaction });
      }
      await this.bitacora.registrar(
        { usuario, entidad: 'tabulador', accion: 'aumento_general', despues: { ...datos, vigencia, renglones: filas.length } },
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
    const tab = (await this.tablas.tabuladorVigente(hoyMexico())).get(`${datos.nivel}-${datos.rango}`);
    if (!tab) throw new BadRequestException('Ese nivel y rango no están en el tabulador.');
    const tablas = await this.tablas.paraNomina(datos.tipoNomina, hoyMexico());
    return calcularRecibo(
      {
        empleadoId: 0,
        sueldoMensual: tab.sueldoMensual,
        compensacionMensual: tab.compensacionMensual,
        gratificacionMensual: tab.gratificacionMensual,
        dias: datos.dias ?? tablas.parametros.diasQuincena,
        fijos: datos.fijos ?? [],
        capturas: [],
        descuentosPlazo: [],
      },
      tablas,
    );
  }

  /** Los renglones vigentes a la fecha del aumento, que son la base de los nuevos. */
  private async filasAumento(datos: AumentoSalarial) {
    if (!(datos.porcentaje > 0 && datos.porcentaje <= 100)) throw new BadRequestException('El porcentaje va de 0 a 100.');
    const vigentes = await this.tablas.tabuladorVigente(datos.vigencia ?? hoyMexico());
    return [...vigentes.values()]
      .filter((t) => !datos.niveles?.length || datos.niveles.includes(t.nivel))
      .sort((a, b) => a.nivel - b.nivel || a.rango - b.rango);
  }
}

const aumentar = (importe: number, porcentaje: number) => Math.round(importe * (1 + porcentaje / 100) * 100) / 100;
