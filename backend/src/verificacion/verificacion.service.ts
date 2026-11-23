import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';
import { PeriodosService } from '../quincena/periodos.service';

export interface Diagnostico {
  clave: string;
  titulo: string;
  descripcion: string;
  severidad: 'error' | 'aviso';
  legado: string;
  total: number;
  muestras: { empleadoId: number | null; nombre: string; detalle: string }[];
}

interface Regla {
  clave: string;
  titulo: string;
  descripcion: string;
  severidad: 'error' | 'aviso';
  legado: string;
  /** Debe regresar empleado_id, nombre y detalle. Recibe :tipo, :periodo y :calculo. */
  sql: string;
  /** Solo tiene sentido si ya hay un cálculo. */
  requiereCalculo?: boolean;
}

const NOMBRE = "concat_ws(' ', e.apellido_paterno, e.apellido_materno, e.nombres)";

/**
 * Revisiones antes de pagar. Juntan en una pantalla lo que hacían por separado los diagnósticos y
 * verificaciones del sistema anterior; cada una dice de qué programa viene.
 */
const REGLAS: Regla[] = [
  {
    clave: 'sin_tabulador',
    titulo: 'Nivel y rango fuera del tabulador',
    descripcion: 'Se calcularían sin sueldo.',
    severidad: 'error',
    legado: '1VERI-CA.W',
    sql: `SELECT e.id empleado_id, ${NOMBRE} nombre, 'Nivel ' || e.nivel || ' rango ' || e.rango detalle
          FROM empleados e
          WHERE e.tipo_nomina = :tipo AND e.estado <> 'baja'
            AND NOT EXISTS (SELECT 1 FROM tabulador t WHERE t.nivel = e.nivel AND t.rango = e.rango AND t.vigencia <= current_date)`,
  },
  {
    clave: 'neto_negativo',
    titulo: 'Neto negativo o en cero',
    descripcion: 'No se puede pagar: las deducciones alcanzan o superan a las percepciones. Corrígelo aquí mismo.',
    severidad: 'error',
    legado: '1VERI-CA.W',
    requiereCalculo: true,
    sql: `SELECT r.empleado_id, r.nombre, 'Neto ' || to_char(r.neto, 'FM$999,999,990.00') detalle
          FROM recibos r WHERE r.calculo_id = :calculo AND r.total_percepciones > 0
            AND (r.neto < 0 OR (r.neto = 0 AND :tipo <> 'D')) ORDER BY r.neto`,
  },
  {
    clave: 'sin_cuenta',
    titulo: 'Sin cuenta bancaria',
    descripcion: 'No se pueden dispersar; márcalos para pago con cheque o captura su cuenta.',
    severidad: 'error',
    legado: '1RE-E-CB.W',
    sql: `SELECT e.id empleado_id, ${NOMBRE} nombre, coalesce(e.banco, 'Sin banco') detalle
          FROM empleados e
          WHERE e.tipo_nomina = :tipo AND e.estado <> 'baja' AND NOT e.pago_cheque
            AND coalesce(e.cuenta_bancaria, '') = ''`,
  },
  {
    clave: 'cuenta_duplicada',
    titulo: 'Cuenta bancaria repetida',
    descripcion: 'La misma cuenta está en dos o más empleados activos.',
    severidad: 'error',
    legado: '1TRA-BAN.W (BUSCA-CTA-DUPLI)',
    sql: `SELECT e.id empleado_id, ${NOMBRE} nombre, 'Cuenta ' || e.cuenta_bancaria detalle
          FROM empleados e
          WHERE e.tipo_nomina = :tipo AND e.estado <> 'baja' AND e.cuenta_bancaria IN (
            SELECT cuenta_bancaria FROM empleados
            WHERE tipo_nomina = :tipo AND estado <> 'baja' AND coalesce(cuenta_bancaria, '') <> ''
            GROUP BY cuenta_bancaria HAVING count(*) > 1)
          ORDER BY e.cuenta_bancaria`,
  },
  {
    clave: 'captura_baja',
    titulo: 'Movimientos capturados a empleados de baja',
    descripcion: 'Tienen captura en la quincena aunque su baja es anterior.',
    severidad: 'aviso',
    legado: '1DIAG-CA.W',
    sql: `SELECT DISTINCT e.id empleado_id, ${NOMBRE} nombre, 'Baja ' || to_char(e.fecha_baja, 'DD/MM/YYYY') detalle
          FROM capturas c JOIN empleados e ON e.id = c.empleado_id JOIN periodos p ON p.id = c.periodo_id
          WHERE c.periodo_id = :periodo AND e.fecha_baja < p.fecha_inicio`,
  },
  {
    clave: 'conceptos_sin_partida',
    titulo: 'Claves sin partida contable',
    descripcion: 'No se podrán llevar a la póliza de contabilidad y presupuesto.',
    severidad: 'aviso',
    legado: '1DIAG-CA.W (diagnóstico de ctas. contables)',
    sql: `SELECT NULL::int empleado_id, lpad(c.clave::text, 3, '0') || ' ' || c.descripcion nombre,
                 CASE c.naturaleza WHEN 'P' THEN 'Percepción' ELSE 'Deducción' END detalle
          FROM conceptos c WHERE c.tipo_nomina = :tipo AND c.activo AND coalesce(c.partida, '') = ''`,
  },
  {
    clave: 'aportacion_sin_cuenta',
    titulo: 'Préstamos o aportaciones sin cuenta contable',
    descripcion: 'Tienen el descuento pero no la cuenta contable del acreedor.',
    severidad: 'aviso',
    legado: '1Diag-ap.W',
    sql: `SELECT e.id empleado_id, ${NOMBRE} nombre, 'Clave ' || co.clave || ' ' || co.descripcion detalle
          FROM (SELECT empleado_id, concepto_id FROM empleado_conceptos
                UNION SELECT empleado_id, concepto_id FROM descuentos_plazo WHERE activo) d
          JOIN empleados e ON e.id = d.empleado_id
          JOIN conceptos co ON co.id = d.concepto_id
          WHERE e.tipo_nomina = :tipo AND e.estado <> 'baja'
            AND co.id IN (SELECT DISTINCT concepto_id FROM cuentas_contables)
            AND NOT EXISTS (SELECT 1 FROM cuentas_contables cc WHERE cc.empleado_id = d.empleado_id AND cc.concepto_id = d.concepto_id)`,
  },
  {
    clave: 'eventual_como_fijo',
    titulo: 'Claves eventuales asignadas como fijas',
    descripcion: 'Se repetirían cada quincena; deberían capturarse solo en la quincena que tocan.',
    severidad: 'aviso',
    legado: '1VER-NOM.W (cves. fijas sin soporte)',
    sql: `SELECT e.id empleado_id, ${NOMBRE} nombre, 'Clave ' || co.clave || ' ' || co.descripcion detalle
          FROM empleado_conceptos ec JOIN empleados e ON e.id = ec.empleado_id JOIN conceptos co ON co.id = ec.concepto_id
          WHERE e.tipo_nomina = :tipo AND e.estado <> 'baja' AND co.periodicidad = 'E'`,
  },
  {
    clave: 'variacion_neto',
    titulo: 'Neto muy distinto a la quincena anterior',
    descripcion: 'Cambió más de 30 % contra la última nómina cerrada. Puede ser correcto; conviene revisarlo.',
    severidad: 'aviso',
    legado: '1VERI-CA.W',
    requiereCalculo: true,
    sql: `WITH anterior AS (
            SELECT c.id FROM calculos c JOIN periodos p ON p.id = c.periodo_id
            WHERE p.tipo_nomina = :tipo AND p.estado = 'cerrado' AND c.tipo = 'nomina' AND c.estado = 'terminado'
            ORDER BY p.anio DESC, p.quincena DESC LIMIT 1)
          SELECT r.empleado_id, r.nombre,
                 to_char(a.neto, 'FM$999,999,990.00') || ' → ' || to_char(r.neto, 'FM$999,999,990.00') detalle
          FROM recibos r JOIN recibos a ON a.empleado_id = r.empleado_id AND a.calculo_id = (SELECT id FROM anterior)
          WHERE r.calculo_id = :calculo AND a.neto > 0 AND abs(r.neto - a.neto) / a.neto > 0.3
          ORDER BY abs(r.neto - a.neto) DESC`,
  },
];

@Injectable()
export class VerificacionService {
  constructor(
    @InjectConnection() private readonly db: Sequelize,
    private readonly periodos: PeriodosService,
  ) {}

  async diagnosticos(periodoId: number): Promise<{ calculoId: number | null; diagnosticos: Diagnostico[] }> {
    const periodo = await this.periodos.buscar(periodoId);
    const [ultimo] = await this.db.query<{ id: number }>(
      `SELECT id FROM calculos WHERE periodo_id = :periodo AND estado = 'terminado' AND tipo IN ('prenomina', 'nomina')
       ORDER BY id DESC LIMIT 1`,
      { replacements: { periodo: periodoId }, type: QueryTypes.SELECT },
    );
    const calculo = ultimo?.id ?? null;

    const diagnosticos = await Promise.all(
      REGLAS.map(async ({ sql, requiereCalculo, ...regla }) => {
        if (requiereCalculo && !calculo) return { ...regla, total: 0, muestras: [] };
        const filas = await this.db.query<{ empleado_id: number | null; nombre: string; detalle: string }>(sql, {
          replacements: { tipo: periodo.tipoNomina, periodo: periodoId, calculo },
          type: QueryTypes.SELECT,
        });
        return {
          ...regla,
          total: filas.length,
          muestras: filas.slice(0, 50).map((f) => ({ empleadoId: f.empleado_id, nombre: f.nombre, detalle: f.detalle })),
        };
      }),
    );
    return { calculoId: calculo, diagnosticos };
  }
}
