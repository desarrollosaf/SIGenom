import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BitacoraService } from '../common/bitacora.service';
import { TablasService } from '../common/tablas.service';
import { Tabulador } from '../database/models/catalogos.models';

interface FilaRang { nivel: number; rango: number; sueldoQ: number; gratificacionQ: number; compensacionQ: number }

/** La hoja trae decimales con coma (4179,1) y sin separador de miles. */
const numero = (t: string | undefined) => Number(String(t ?? '').trim().replace(',', '.'));

/**
 * Lee la tabla-rang: la hoja de Excel guardada como CSV (NIVEL;IMP-NIVEL;IMP-RAN-1..5;IMP-COMP-1..5) o
 * el tabla-rang.txt del respaldo de quincena (sin encabezado, separado por espacios). Importes
 * quincenales; el renglón del nivel 0 no es un nivel y se omite.
 */
export function leerTablaRang(contenido: string): FilaRang[] {
  const lineas = contenido.split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (!lineas.length) throw new BadRequestException('El archivo está vacío.');
  const filas: FilaRang[] = [];
  const agregar = (nivel: number, sueldoQ: number, ran: number[], comp: number[]) => {
    if (!Number.isInteger(nivel) || nivel <= 0) return;
    const todos = [sueldoQ, ...ran, ...comp];
    if (todos.some((x) => !Number.isFinite(x) || x < 0) || sueldoQ <= 0) throw new BadRequestException(`Nivel ${nivel}: hay importes no válidos.`);
    for (let r = 1; r <= 5; r++) filas.push({ nivel, rango: r, sueldoQ, gratificacionQ: ran[r - 1], compensacionQ: comp[r - 1] });
  };
  if (/NIVEL/i.test(lineas[0])) {
    const delimitador = lineas[0].includes(';') ? ';' : ',';
    const encabezado = lineas[0].split(delimitador).map((c) => c.trim().toUpperCase());
    const columna = (nombre: string) => {
      const i = encabezado.indexOf(nombre);
      if (i < 0) throw new BadRequestException(`Falta la columna ${nombre}.`);
      return i;
    };
    const cinco = (prefijo: string) => [1, 2, 3, 4, 5].map((r) => columna(`${prefijo}-${r}`));
    const [cn, cs, cr, cc] = [columna('NIVEL'), columna('IMP-NIVEL'), cinco('IMP-RAN'), cinco('IMP-COMP')];
    for (const linea of lineas.slice(1)) {
      const v = linea.split(delimitador);
      agregar(numero(v[cn]), numero(v[cs]), cr.map((i) => numero(v[i])), cc.map((i) => numero(v[i])));
    }
  } else {
    for (const linea of lineas) {
      const v = linea.trim().split(/\s+/).map(numero);
      if (v.length >= 12) agregar(v[0], v[1], v.slice(2, 7), v.slice(7, 12));
    }
  }
  if (!filas.length) throw new BadRequestException('No se encontró ningún nivel. ¿Es la tabla-rang?');
  return filas;
}

@Injectable()
export class TablaRangService {
  constructor(
    private readonly tablas: TablasService,
    private readonly bitacora: BitacoraService,
    @InjectModel(Tabulador) private readonly tabulador: typeof Tabulador,
  ) {}

  /** Compara contra lo vigente a esa fecha y, si se pide, guarda la tabla como vigencia nueva. */
  async importar(contenido: string, vigencia: string, aplicar: boolean, usuario: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia) || Number.isNaN(Date.parse(vigencia))) throw new BadRequestException('Escribe desde qué fecha vale la tabla.');
    const filas = leerTablaRang(contenido);
    const vigente = await this.tablas.tabuladorVigente(vigencia);
    const mensual = (q: number) => Math.round(q * 200) / 100;
    const renglones = filas.map((f) => {
      const a = vigente.get(`${f.nivel}-${f.rango}`);
      const nuevo = { sueldoMensual: mensual(f.sueldoQ), gratificacionMensual: mensual(f.gratificacionQ), compensacionMensual: mensual(f.compensacionQ) };
      const igual = !!a && a.sueldoMensual === nuevo.sueldoMensual && a.gratificacionMensual === nuevo.gratificacionMensual && a.compensacionMensual === nuevo.compensacionMensual;
      return { ...f, ...nuevo, anterior: a ? a.sueldoMensual / 2 : null, estado: !a ? 'nuevo' : igual ? 'igual' : 'cambia' };
    });
    const resultado = {
      vigencia,
      niveles: new Set(filas.map((f) => f.nivel)).size,
      nuevos: renglones.filter((r) => r.estado === 'nuevo').length,
      cambian: renglones.filter((r) => r.estado === 'cambia').length,
      iguales: renglones.filter((r) => r.estado === 'igual').length,
      /** Niveles que hoy existen y no vienen en el archivo: siguen con la tabla anterior. */
      faltan: [...new Set([...vigente.values()].filter((t) => t.nivel > 0 && !filas.some((f) => f.nivel === t.nivel)).map((t) => t.nivel))],
      muestra: renglones.filter((r) => r.rango === 1 && r.estado !== 'igual').slice(0, 40)
        .map((r) => ({ nivel: r.nivel, antes: r.anterior, despues: r.sueldoQ })),
      aplicado: false,
    };
    if (!aplicar) return resultado;

    await this.tabulador.sequelize!.transaction(async (transaction) => {
      await this.tabulador.bulkCreate(
        renglones.map((r) => ({
          vigencia, nivel: r.nivel, rango: r.rango, sueldoMensual: r.sueldoMensual,
          gratificacionMensual: r.gratificacionMensual, compensacionMensual: r.compensacionMensual,
        })),
        { transaction, updateOnDuplicate: ['sueldoMensual', 'gratificacionMensual', 'compensacionMensual', 'updatedAt'], conflictAttributes: ['vigencia', 'nivel', 'rango'] },
      );
      await this.bitacora.registrar(
        { usuario, entidad: 'tabulador', accion: 'importa_tabla_rang', despues: { vigencia, renglones: renglones.length, nuevos: resultado.nuevos, cambian: resultado.cambian } },
        transaction,
      );
    });
    return { ...resultado, aplicado: true };
  }
}
