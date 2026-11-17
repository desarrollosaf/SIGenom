'use strict';

/**
 * Esquema inicial de SIGenom, a partir de la base Progress "persona" del sistema de nóminas.
 *
 * Equivalencias con las tablas de Progress:
 *   Empleado / Emplea-v / Emplea-t        -> empleados (tipo_nomina distingue Principal, Viáticos, Telefonía…)
 *   Datos-per, Nombres                    -> empleados (nombre separado) y datos_personales
 *   Cata-pd                               -> conceptos
 *   Pag-des (t-m fijo)                    -> empleado_conceptos
 *   Pag-des (t-m = "Q")                   -> capturas (movimientos de una quincena)
 *   Desc-palim                            -> descuentos_plazo
 *   Apo-des                               -> cuentas_contables
 *   Suc-banc                              -> sucursales_bancarias
 *   Cata-ispt / Tab-cre                   -> tabla_isr / tabla_subsidio
 *   tabla-rang                            -> tabulador
 *   Cata-adsc / Cata-pues / Cat-mot       -> adscripciones / puestos / motivos
 *   H-bajas, H-permi, His-b, movp, Fum    -> movimientos_personal
 *   H-mov, H-perded                       -> bitacora
 *   Calculos                              -> calculos
 *   res-qnas y los respaldos .d por qna   -> periodos + recibos + recibo_conceptos (cada quincena queda guardada)
 */

const dinero = (Sequelize, extra = {}) => ({
  type: Sequelize.DECIMAL(14, 2),
  allowNull: false,
  defaultValue: 0,
  ...extra,
});

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tiempos = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
    };
    const id = { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false };
    const ref = (model, extra = {}) => ({
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model, key: 'id' },
      onDelete: 'RESTRICT',
      ...extra,
    });

    await queryInterface.sequelize.transaction(async (transaction) => {
      const t = { transaction };

      // --- Acceso -----------------------------------------------------------------------------
      await queryInterface.createTable(
        'usuarios',
        {
          id,
          usuario: { type: Sequelize.STRING(20), allowNull: false, unique: true },
          nombre: { type: Sequelize.STRING(120), allowNull: false },
          password_hash: { type: Sequelize.STRING(100), allowNull: false },
          rol: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'consulta' },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          ultimo_acceso: { type: Sequelize.DATE },
          ...tiempos,
        },
        t,
      );

      // --- Catálogos --------------------------------------------------------------------------
      await queryInterface.createTable(
        'tipos_nomina',
        {
          clave: { type: Sequelize.STRING(1), primaryKey: true },
          nombre: { type: Sequelize.STRING(40), allowNull: false },
          orden: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        },
        t,
      );

      await queryInterface.createTable(
        'adscripciones',
        {
          id: { type: Sequelize.INTEGER, primaryKey: true },
          descripcion: { type: Sequelize.STRING(120), allowNull: false },
          area_presupuestal: { type: Sequelize.STRING(20) },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          ...tiempos,
        },
        t,
      );

      await queryInterface.createTable(
        'puestos',
        {
          clave: { type: Sequelize.STRING(12), primaryKey: true },
          descripcion: { type: Sequelize.STRING(120), allowNull: false },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          ...tiempos,
        },
        t,
      );

      await queryInterface.createTable(
        'tabulador',
        {
          id,
          nivel: { type: Sequelize.SMALLINT, allowNull: false },
          rango: { type: Sequelize.SMALLINT, allowNull: false },
          sueldo_mensual: dinero(Sequelize),
          compensacion_mensual: dinero(Sequelize),
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('tabulador', ['nivel', 'rango'], { unique: true, ...t });

      await queryInterface.createTable(
        'conceptos',
        {
          id,
          tipo_nomina: {
            type: Sequelize.STRING(1),
            allowNull: false,
            references: { model: 'tipos_nomina', key: 'clave' },
          },
          clave: { type: Sequelize.SMALLINT, allowNull: false },
          abreviatura: { type: Sequelize.STRING(12), allowNull: false },
          descripcion: { type: Sequelize.STRING(60), allowNull: false },
          /** P percepción, D deducción. */
          naturaleza: { type: Sequelize.STRING(1), allowNull: false },
          /** F fija (se repite cada quincena), E eventual (solo la quincena capturada). */
          periodicidad: { type: Sequelize.STRING(1), allowNull: false, defaultValue: 'F' },
          grava_isr: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          /** Factor sobre el importe que integra la base de cotización ISSEMYM (0 a 1). */
          factor_issemym: { type: Sequelize.DECIMAL(5, 3), allowNull: false, defaultValue: 0 },
          partida: { type: Sequelize.STRING(16) },
          clave_issemym: { type: Sequelize.SMALLINT },
          /** Concepto que el motor calcula solo (sueldo, ISR, ISSEMYM…); no se captura a mano. */
          calculado: { type: Sequelize.STRING(20) },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('conceptos', ['tipo_nomina', 'clave'], { unique: true, ...t });

      await queryInterface.createTable(
        'tabla_isr',
        {
          id,
          vigencia: { type: Sequelize.DATEONLY, allowNull: false },
          limite_inferior: dinero(Sequelize),
          cuota_fija: dinero(Sequelize),
          porcentaje: { type: Sequelize.DECIMAL(6, 4), allowNull: false, defaultValue: 0 },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('tabla_isr', ['vigencia', 'limite_inferior'], { unique: true, ...t });

      await queryInterface.createTable(
        'tabla_subsidio',
        {
          id,
          vigencia: { type: Sequelize.DATEONLY, allowNull: false },
          ingreso_desde: dinero(Sequelize),
          subsidio: dinero(Sequelize),
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('tabla_subsidio', ['vigencia', 'ingreso_desde'], {
        unique: true,
        ...t,
      });

      await queryInterface.createTable(
        'motivos',
        {
          clave: { type: Sequelize.STRING(4), primaryKey: true },
          descripcion: { type: Sequelize.STRING(80), allowNull: false },
          /** B baja, P permiso o suspensión. */
          aplica: { type: Sequelize.STRING(1), allowNull: false, defaultValue: 'B' },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          ...tiempos,
        },
        t,
      );

      await queryInterface.createTable(
        'parametros',
        {
          clave: { type: Sequelize.STRING(40), primaryKey: true },
          valor: { type: Sequelize.STRING(200), allowNull: false },
          descripcion: { type: Sequelize.STRING(200), allowNull: false },
          ...tiempos,
        },
        t,
      );

      // --- Personal ---------------------------------------------------------------------------
      await queryInterface.createTable(
        'empleados',
        {
          id,
          curp: { type: Sequelize.STRING(18), allowNull: false },
          rfc: { type: Sequelize.STRING(13), allowNull: false },
          apellido_paterno: { type: Sequelize.STRING(50), allowNull: false },
          apellido_materno: { type: Sequelize.STRING(50) },
          nombres: { type: Sequelize.STRING(60), allowNull: false },
          tipo_nomina: {
            type: Sequelize.STRING(1),
            allowNull: false,
            references: { model: 'tipos_nomina', key: 'clave' },
          },
          adscripcion_id: ref('adscripciones'),
          puesto_clave: {
            type: Sequelize.STRING(12),
            allowNull: false,
            references: { model: 'puestos', key: 'clave' },
          },
          nivel: { type: Sequelize.SMALLINT, allowNull: false },
          rango: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 1 },
          numero_issemym: { type: Sequelize.INTEGER },
          sindicalizado: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          sci: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          /** activo, permiso (suspendido sin goce) o baja. */
          estado: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'activo' },
          fecha_alta: { type: Sequelize.DATEONLY, allowNull: false },
          fecha_baja: { type: Sequelize.DATEONLY },
          fecha_ingreso_gobierno: { type: Sequelize.DATEONLY },
          fecha_nacimiento: { type: Sequelize.DATEONLY },
          codigo_postal_fiscal: { type: Sequelize.STRING(5) },
          banco: { type: Sequelize.STRING(20) },
          cuenta_bancaria: { type: Sequelize.STRING(18) },
          /** El "*" de Empleado.dto: se excluye de la dispersión y se paga con cheque. */
          pago_cheque: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('empleados', ['curp', 'tipo_nomina'], { unique: true, ...t });
      await queryInterface.addIndex('empleados', ['rfc'], t);
      await queryInterface.addIndex('empleados', ['tipo_nomina', 'estado'], t);

      await queryInterface.createTable(
        'datos_personales',
        {
          empleado_id: ref('empleados', { primaryKey: true, onDelete: 'CASCADE' }),
          sexo: { type: Sequelize.STRING(1) },
          estado_civil: { type: Sequelize.STRING(20) },
          correo: { type: Sequelize.STRING(120) },
          telefono: { type: Sequelize.STRING(20) },
          domicilio: { type: Sequelize.STRING(150) },
          colonia: { type: Sequelize.STRING(80) },
          codigo_postal: { type: Sequelize.STRING(5) },
          entidad: { type: Sequelize.STRING(40) },
          profesion: { type: Sequelize.STRING(80) },
          observaciones: { type: Sequelize.TEXT },
          ...tiempos,
        },
        t,
      );

      await queryInterface.createTable(
        'empleado_conceptos',
        {
          id,
          empleado_id: ref('empleados', { onDelete: 'CASCADE' }),
          concepto_id: ref('conceptos'),
          importe: dinero(Sequelize),
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('empleado_conceptos', ['empleado_id', 'concepto_id'], {
        unique: true,
        ...t,
      });

      await queryInterface.createTable(
        'descuentos_plazo',
        {
          id,
          empleado_id: ref('empleados', { onDelete: 'CASCADE' }),
          concepto_id: ref('conceptos'),
          importe_quincenal: dinero(Sequelize),
          /** Pensión alimenticia por porcentaje del neto; si tiene valor, manda sobre el importe. */
          porcentaje: { type: Sequelize.DECIMAL(6, 3) },
          quincenas_pendientes: { type: Sequelize.SMALLINT },
          beneficiario: { type: Sequelize.STRING(120) },
          activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          ...tiempos,
        },
        t,
      );

      await queryInterface.createTable(
        'cuentas_contables',
        {
          id,
          empleado_id: ref('empleados', { onDelete: 'CASCADE' }),
          concepto_id: ref('conceptos'),
          partida: { type: Sequelize.STRING(16), allowNull: false },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('cuentas_contables', ['empleado_id', 'concepto_id'], {
        unique: true,
        ...t,
      });

      await queryInterface.createTable(
        'sucursales_bancarias',
        {
          id,
          empleado_id: ref('empleados', { onDelete: 'CASCADE' }),
          sucursal: { type: Sequelize.SMALLINT, allowNull: false },
          /** E empleado, D diputado (Suc-banc.tip-tab). */
          tipo: { type: Sequelize.STRING(1), allowNull: false, defaultValue: 'E' },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('sucursales_bancarias', ['empleado_id'], { unique: true, ...t });

      // --- Periodos y cálculo -----------------------------------------------------------------
      await queryInterface.createTable(
        'periodos',
        {
          id,
          tipo_nomina: {
            type: Sequelize.STRING(1),
            allowNull: false,
            references: { model: 'tipos_nomina', key: 'clave' },
          },
          anio: { type: Sequelize.SMALLINT, allowNull: false },
          quincena: { type: Sequelize.SMALLINT, allowNull: false },
          fecha_inicio: { type: Sequelize.DATEONLY, allowNull: false },
          fecha_fin: { type: Sequelize.DATEONLY, allowNull: false },
          fecha_pago: { type: Sequelize.DATEONLY },
          /** captura -> prenomina -> nomina -> cerrado */
          estado: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'captura' },
          cerrado_por: { type: Sequelize.STRING(20) },
          cerrado_el: { type: Sequelize.DATE },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('periodos', ['tipo_nomina', 'anio', 'quincena'], {
        unique: true,
        ...t,
      });

      await queryInterface.createTable(
        'movimientos_personal',
        {
          id,
          empleado_id: ref('empleados', { onDelete: 'CASCADE' }),
          periodo_id: ref('periodos', { allowNull: true }),
          /** alta, baja, permiso, reingreso, cambio */
          tipo: { type: Sequelize.STRING(10), allowNull: false },
          motivo_clave: {
            type: Sequelize.STRING(4),
            references: { model: 'motivos', key: 'clave' },
          },
          fecha_inicio: { type: Sequelize.DATEONLY, allowNull: false },
          fecha_fin: { type: Sequelize.DATEONLY },
          detalle: { type: Sequelize.JSONB },
          observaciones: { type: Sequelize.TEXT },
          cancelado: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          cancelado_por: { type: Sequelize.STRING(20) },
          registrado_por: { type: Sequelize.STRING(20), allowNull: false },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('movimientos_personal', ['empleado_id', 'fecha_inicio'], t);

      await queryInterface.createTable(
        'capturas',
        {
          id,
          periodo_id: ref('periodos', { onDelete: 'CASCADE' }),
          empleado_id: ref('empleados'),
          concepto_id: ref('conceptos'),
          importe: dinero(Sequelize),
          /** captura, inasistencias, reintegros, caja, comedor… (de dónde llegó el movimiento) */
          origen: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'captura' },
          referencia: { type: Sequelize.STRING(80) },
          registrado_por: { type: Sequelize.STRING(20), allowNull: false },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('capturas', ['periodo_id', 'empleado_id'], t);

      await queryInterface.createTable(
        'calculos',
        {
          id,
          periodo_id: ref('periodos', { onDelete: 'CASCADE' }),
          /** prenomina, nomina, aguinaldo, prima_vacacional */
          tipo: { type: Sequelize.STRING(20), allowNull: false },
          /** en_cola, procesando, terminado, error, reemplazado */
          estado: { type: Sequelize.STRING(12), allowNull: false, defaultValue: 'en_cola' },
          total_empleados: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          procesados: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          total_percepciones: dinero(Sequelize),
          total_deducciones: dinero(Sequelize),
          total_neto: dinero(Sequelize),
          error: { type: Sequelize.TEXT },
          solicitado_por: { type: Sequelize.STRING(20), allowNull: false },
          iniciado_el: { type: Sequelize.DATE },
          terminado_el: { type: Sequelize.DATE },
          ...tiempos,
        },
        t,
      );
      await queryInterface.addIndex('calculos', ['periodo_id', 'tipo', 'estado'], t);

      await queryInterface.createTable(
        'recibos',
        {
          id,
          calculo_id: ref('calculos', { onDelete: 'CASCADE' }),
          empleado_id: ref('empleados'),
          // Foto del empleado al calcular: el recibo no cambia aunque después cambie su puesto.
          nombre: { type: Sequelize.STRING(170), allowNull: false },
          curp: { type: Sequelize.STRING(18), allowNull: false },
          rfc: { type: Sequelize.STRING(13), allowNull: false },
          adscripcion_id: { type: Sequelize.INTEGER, allowNull: false },
          puesto_clave: { type: Sequelize.STRING(12), allowNull: false },
          nivel: { type: Sequelize.SMALLINT, allowNull: false },
          rango: { type: Sequelize.SMALLINT, allowNull: false },
          dias: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 15 },
          base_isr: dinero(Sequelize),
          base_issemym: dinero(Sequelize),
          isr_causado: dinero(Sequelize),
          subsidio: dinero(Sequelize),
          total_percepciones: dinero(Sequelize),
          total_deducciones: dinero(Sequelize),
          neto: dinero(Sequelize),
          cuenta_bancaria: { type: Sequelize.STRING(18) },
          pago_cheque: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
          observaciones: { type: Sequelize.JSONB },
          created_at: tiempos.created_at,
        },
        t,
      );
      await queryInterface.addIndex('recibos', ['calculo_id', 'empleado_id'], { unique: true, ...t });

      await queryInterface.createTable(
        'recibo_conceptos',
        {
          id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
          recibo_id: ref('recibos', { onDelete: 'CASCADE' }),
          concepto_id: ref('conceptos'),
          clave: { type: Sequelize.SMALLINT, allowNull: false },
          descripcion: { type: Sequelize.STRING(60), allowNull: false },
          naturaleza: { type: Sequelize.STRING(1), allowNull: false },
          importe: dinero(Sequelize),
          gravado_isr: dinero(Sequelize),
          partida: { type: Sequelize.STRING(16) },
        },
        t,
      );
      await queryInterface.addIndex('recibo_conceptos', ['recibo_id'], t);

      // --- Bitácora ---------------------------------------------------------------------------
      await queryInterface.createTable(
        'bitacora',
        {
          id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
          usuario: { type: Sequelize.STRING(20), allowNull: false },
          entidad: { type: Sequelize.STRING(30), allowNull: false },
          entidad_id: { type: Sequelize.STRING(40) },
          accion: { type: Sequelize.STRING(30), allowNull: false },
          antes: { type: Sequelize.JSONB },
          despues: { type: Sequelize.JSONB },
          created_at: tiempos.created_at,
        },
        t,
      );
      await queryInterface.addIndex('bitacora', ['entidad', 'entidad_id'], t);
      await queryInterface.addIndex('bitacora', ['created_at'], t);
    });
  },

  async down(queryInterface) {
    const tablas = [
      'bitacora',
      'recibo_conceptos',
      'recibos',
      'calculos',
      'capturas',
      'movimientos_personal',
      'periodos',
      'sucursales_bancarias',
      'cuentas_contables',
      'descuentos_plazo',
      'empleado_conceptos',
      'datos_personales',
      'empleados',
      'parametros',
      'motivos',
      'tabla_subsidio',
      'tabla_isr',
      'conceptos',
      'tabulador',
      'puestos',
      'adscripciones',
      'tipos_nomina',
      'usuarios',
    ];
    for (const tabla of tablas) await queryInterface.dropTable(tabla);
  },
};
