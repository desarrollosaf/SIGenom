import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Parametro, TipoNomina } from '../database/models/catalogos.models';
import { Recibo } from '../database/models/nomina.models';
import { SucursalBancaria } from '../database/models/personal.models';
import { CalculosService } from '../quincena/calculos.service';
import { archivoBanamex, cuentaDispersable } from './layouts/citibanamex';

export const LAYOUTS = [
  { clave: 'citibanamex', nombre: 'Citibanamex · pago de nómina', extension: 'txt', legado: '1TRA-BAN.W' },
  { clave: 'csv', nombre: 'CSV genérico (nombre, cuenta, importe)', extension: 'csv', legado: '1LIS-COM.W' },
];

@Injectable()
export class DispersionService {
  constructor(
    private readonly calculos: CalculosService,
    @InjectModel(Recibo) private readonly recibos: typeof Recibo,
    @InjectModel(SucursalBancaria) private readonly sucursales: typeof SucursalBancaria,
    @InjectModel(Parametro) private readonly parametros: typeof Parametro,
    @InjectModel(TipoNomina) private readonly tipos: typeof TipoNomina,
  ) {}

  /** Cómo se va a pagar el cálculo: cuántos por transferencia, cuántos con cheque y quiénes no se pueden pagar. */
  async resumen(calculoId: number) {
    const calculo = await this.exigirTerminado(calculoId);
    const recibos = await this.recibos.findAll({ where: { calculoId, neto: { [Op.gt]: 0 } }, order: [['nombre', 'ASC']] });
    const grupos = { transferencia: [] as Recibo[], cheque: [] as Recibo[], sinCuenta: [] as Recibo[] };
    for (const r of recibos) {
      if (r.pagoCheque) grupos.cheque.push(r);
      else if (cuentaDispersable(r.cuentaBancaria)) grupos.transferencia.push(r);
      else grupos.sinCuenta.push(r);
    }
    const suma = (lista: Recibo[]) => lista.reduce((s, r) => s + Math.round(r.neto * 100), 0) / 100;
    const vista = (r: Recibo) => ({ id: r.id, empleadoId: r.empleadoId, nombre: r.nombre, rfc: r.rfc, cuenta: r.cuentaBancaria, neto: r.neto });
    return {
      calculo: { id: calculo.id, tipo: calculo.tipo, periodoId: calculo.periodoId },
      layouts: LAYOUTS,
      transferencia: { total: grupos.transferencia.length, importe: suma(grupos.transferencia) },
      cheque: { total: grupos.cheque.length, importe: suma(grupos.cheque), recibos: grupos.cheque.map(vista) },
      sinCuenta: { total: grupos.sinCuenta.length, importe: suma(grupos.sinCuenta), recibos: grupos.sinCuenta.map(vista) },
    };
  }

  async archivo(calculoId: number, layout: string, fecha: string, secuencia: number) {
    const calculo = await this.exigirTerminado(calculoId);
    const recibos = (await this.recibos.findAll({ where: { calculoId, neto: { [Op.gt]: 0 }, pagoCheque: false }, order: [['nombre', 'ASC']] }))
      .filter((r) => cuentaDispersable(r.cuentaBancaria));
    if (recibos.length === 0) throw new BadRequestException('No hay recibos para dispersar.');

    const definicion = LAYOUTS.find((l) => l.clave === layout);
    if (!definicion) throw new BadRequestException('Layout no válido.');
    const nombre = `dispersion-${calculo.periodo.tipoNomina}-${calculo.periodo.anio}-${String(calculo.periodo.quincena).padStart(2, '0')}-${secuencia}.${definicion.extension}`;

    if (layout === 'csv') {
      const filas = recibos.map((r) => [r.nombre, r.rfc, r.cuentaBancaria, r.neto.toFixed(2)].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
      return { nombre, contenido: ['"Nombre","RFC","Cuenta","Importe"', ...filas].join('\r\n') + '\r\n' };
    }

    const p = new Map((await this.parametros.findAll({ where: { clave: { [Op.like]: 'banamex_%' } } })).map((x) => [x.clave, x.valor.trim()]));
    const faltan = ['banamex_cliente', 'banamex_sucursal_cargo', 'banamex_cuenta_cargo'].filter((c) => !p.get(c));
    if (faltan.length) {
      throw new BadRequestException(`Captura en Catálogos > Parámetros los datos del contrato: ${faltan.join(', ')}.`);
    }
    const tipo = await this.tipos.findByPk(calculo.periodo.tipoNomina);
    const sucursales = new Map(
      (await this.sucursales.findAll({ where: { empleadoId: recibos.map((r) => r.empleadoId) } })).map((s) => [s.empleadoId, s.sucursal]),
    );
    const contenido = archivoBanamex(
      {
        cliente: p.get('banamex_cliente')!,
        sucursalCargo: p.get('banamex_sucursal_cargo')!,
        cuentaCargo: p.get('banamex_cuenta_cargo')!,
        razonSocial: p.get('banamex_razon_social') ?? '',
        descripcion: `TE N ${tipo?.nombre ?? ''}`,
      },
      fecha,
      secuencia,
      recibos.map((r) => ({ nombre: r.nombre, cuenta: r.cuentaBancaria!, sucursal: sucursales.get(r.empleadoId) ?? null, importe: r.neto })),
    );
    return { nombre, contenido };
  }

  private async exigirTerminado(calculoId: number) {
    const calculo = await this.calculos.buscar(calculoId);
    if (calculo.estado !== 'terminado') throw new BadRequestException('El cálculo todavía no termina.');
    return calculo;
  }
}
