import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import type { WhereOptions } from 'sequelize';
import { BitacoraService } from '../common/bitacora.service';
import {
  Adscripcion,
  Concepto,
  Motivo,
  Puesto,
  TipoNomina,
} from '../database/models/catalogos.models';
import { CampoCatalogo, CATALOGOS, definicion, DefinicionCatalogo } from './definiciones';

@Injectable()
export class CatalogosService {
  constructor(
    private readonly bitacora: BitacoraService,
    @InjectModel(TipoNomina) private readonly tipos: typeof TipoNomina,
    @InjectModel(Adscripcion) private readonly adscripciones: typeof Adscripcion,
    @InjectModel(Puesto) private readonly puestos: typeof Puesto,
    @InjectModel(Motivo) private readonly motivos: typeof Motivo,
    @InjectModel(Concepto) private readonly conceptos: typeof Concepto,
  ) {}

  /** Las definiciones, sin el modelo, más cuántos renglones tiene cada catálogo. */
  async definiciones() {
    return Promise.all(
      CATALOGOS.map(async ({ modelo, ...def }) => ({ ...def, total: await modelo.count() })),
    );
  }

  async listar(clave: string, tipoNomina?: string) {
    const def = this.def(clave);
    const where: WhereOptions = def.porTipoNomina && tipoNomina ? { tipoNomina } : {};
    return def.modelo.findAll({ where, order: def.orden });
  }

  async crear(clave: string, datos: Record<string, unknown>, usuario: string) {
    const def = this.def(clave);
    if (def.soloEdicion) throw new BadRequestException('Este catálogo solo se edita.');
    const valores = this.validar(def, datos, true);
    const creado = await def.modelo.create(valores);
    await this.bitacora.registrar({
      usuario,
      entidad: `catalogo:${clave}`,
      entidadId: String(creado.get(def.llave)),
      accion: 'alta',
      despues: valores,
    });
    return creado;
  }

  async actualizar(clave: string, id: string, datos: Record<string, unknown>, usuario: string) {
    const def = this.def(clave);
    const registro = await this.buscar(def, id);
    const valores = this.validar(def, datos, false);
    const antes = registro.get({ plain: true }) as Record<string, unknown>;
    await registro.update(valores);
    const cambio = BitacoraService.diferencias(antes, valores);
    if (cambio) {
      await this.bitacora.registrar({ usuario, entidad: `catalogo:${clave}`, entidadId: id, accion: 'cambio', ...cambio });
    }
    return registro;
  }

  async eliminar(clave: string, id: string, usuario: string) {
    const def = this.def(clave);
    if (def.soloEdicion) throw new BadRequestException('Este catálogo solo se edita.');
    const registro = await this.buscar(def, id);
    const antes = registro.get({ plain: true }) as Record<string, unknown>;
    await registro.destroy();
    await this.bitacora.registrar({ usuario, entidad: `catalogo:${clave}`, entidadId: id, accion: 'baja', antes });
  }

  /** Listas cortas para los selectores del frontend. */
  async opciones(tipoNomina?: string) {
    const [tiposNomina, adscripciones, puestos, motivos, conceptos] = await Promise.all([
      this.tipos.findAll({ where: { activo: true }, order: [['orden', 'ASC']] }),
      this.adscripciones.findAll({ where: { activo: true }, order: [['id', 'ASC']] }),
      this.puestos.findAll({ where: { activo: true }, order: [['descripcion', 'ASC']] }),
      this.motivos.findAll({ where: { activo: true }, order: [['clave', 'ASC']] }),
      this.conceptos.findAll({
        where: { activo: true, ...(tipoNomina ? { tipoNomina } : {}) },
        order: [['naturaleza', 'DESC'], ['clave', 'ASC']],
      }),
    ]);
    return {
      tiposNomina: tiposNomina.map((t) => ({ clave: t.clave, nombre: t.nombre })),
      adscripciones: adscripciones.map((a) => ({ id: a.id, nombre: a.descripcion })),
      puestos: puestos.map((p) => ({ clave: p.clave, nombre: p.descripcion })),
      motivos: motivos.map((m) => ({ clave: m.clave, nombre: m.descripcion, aplica: m.aplica })),
      conceptos: conceptos.map((c) => ({
        id: c.id,
        tipoNomina: c.tipoNomina,
        clave: c.clave,
        nombre: c.descripcion,
        naturaleza: c.naturaleza,
        periodicidad: c.periodicidad,
        calculado: c.calculado,
      })),
    };
  }

  private def(clave: string): DefinicionCatalogo {
    const def = definicion(clave);
    if (!def) throw new NotFoundException('Ese catálogo no existe');
    return def;
  }

  private async buscar(def: DefinicionCatalogo, id: string) {
    const registro = await def.modelo.findOne({ where: { [def.llave]: id } });
    if (!registro) throw new NotFoundException('El registro ya no existe');
    return registro;
  }

  /** Solo pasan los campos definidos, convertidos a su tipo. Lo demás se ignora. */
  private validar(def: DefinicionCatalogo, datos: Record<string, unknown>, alta: boolean) {
    const valores: Record<string, unknown> = {};
    const errores: string[] = [];
    for (const campo of def.campos) {
      if (campo.llave && !alta) continue;
      if (def.soloEdicion && campo.clave !== 'valor') continue;
      const crudo = datos[campo.clave];
      const vacio = crudo === undefined || crudo === null || crudo === '';
      if (vacio) {
        if (campo.requerido) errores.push(`${campo.titulo} es obligatorio`);
        else if (crudo !== undefined) valores[campo.clave] = campo.tipo === 'booleano' ? false : null;
        continue;
      }
      const valor = convertir(campo, crudo);
      if (valor === undefined) errores.push(`${campo.titulo} no tiene un valor válido`);
      else valores[campo.clave] = valor;
    }
    if (errores.length) throw new BadRequestException(errores);
    return valores;
  }
}

function convertir(campo: CampoCatalogo, crudo: unknown): unknown {
  const texto = String(crudo).trim();
  switch (campo.tipo) {
    case 'texto':
      return campo.max && texto.length > campo.max ? undefined : texto;
    case 'entero':
      return /^-?\d+$/.test(texto) ? Number(texto) : undefined;
    case 'dinero':
    case 'decimal':
      return Number.isFinite(Number(texto)) ? Number(texto) : undefined;
    case 'fecha':
      return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : undefined;
    case 'booleano':
      return crudo === true || texto === 'true';
    case 'opcion': {
      if (!Array.isArray(campo.opciones)) return texto;
      return campo.opciones.some((o) => o.valor === texto) ? texto || null : undefined;
    }
  }
}

