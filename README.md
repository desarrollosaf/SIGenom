# SIGenom

Sistema de nómina del Poder Legislativo, reescrito en **Angular 22 + NestJS 11 + PostgreSQL**, con
**workers** para los cálculos y todo en **Docker**. Sustituye al sistema Progress 4GL "Sistema de
Administración y Desarrollo de Personal" (`Sistema nóminasZIP`, base `persona`).

Misma estructura de proyecto que SISalidas; diseño, base de datos y procesamiento propios.

## Qué hace

| Pantalla | Para qué |
| --- | --- |
| Inicio | En qué paso va la quincena (captura → prenómina → verificación → nómina → dispersión → cierre), cifras y tendencia. |
| Empleados | Lista, alta y ficha: datos de nómina, conceptos fijos, descuentos a plazo, cuentas, movimientos, recibos y datos personales. |
| Movimientos | Altas, bajas, permisos, reingresos y cambios; cancelación de bajas y permisos. |
| Captura | Lo que solo aplica en la quincena, a mano o importado de un CSV (inasistencias, reintegros, caja, comedor). |
| Cálculo | Prenómina, nómina, aguinaldo y prima vacacional, procesados por el worker con avance en vivo. Revisión de recibos. |
| Verificación | Nueve diagnósticos antes de pagar (sin tabulador, sin cuenta, cuentas repetidas, neto negativo, variaciones…). |
| Pagos y dispersión | Archivo para el banco, cheques, comprobantes en PDF y relaciones para firmas. |
| Quincenas | Abrir, cerrar y consultar quincenas anteriores. |
| Reportes | 13 reportes con un solo visor y exportación a Excel. |
| Estimador de sueldo | Una quincena simulada con el mismo motor que la nómina real. |
| Catálogos | Conceptos, tabulador, tarifa ISR, subsidio, adscripciones, puestos, motivos, tipos de nómina y parámetros. |
| Aumento salarial | Sube el tabulador por porcentaje con vista previa. |
| Usuarios y bitácora | Roles (administrador, nominista, consulta) y quién cambió qué. |

## Arquitectura

```
SIGenom/
├── src/app/
│   ├── core/              API tipada, sesión (JWT), contexto de nómina y quincena, guards
│   ├── layout/shell/      Barra lateral, selector de nómina y quincena, buscador
│   ├── shared/            Íconos, avisos, cajón lateral, buscador de empleados, recibo, formatos
│   └── features/          Una carpeta por pantalla
└── backend/src/
    ├── motor/             Cálculo puro (sin base): ISR, subsidio, ISSEMYM, días, aguinaldo. Con pruebas.
    ├── quincena/          Periodos, captura, cálculo (encola) y el ejecutor que corre en el worker
    ├── empleados/         Ficha y movimientos de personal
    ├── catalogos/         CRUD genérico descrito por definiciones
    ├── verificacion/      Diagnósticos
    ├── dispersion/        Resumen de pago y layouts bancarios
    ├── reportes/          Definiciones SQL + exportación a Excel
    ├── procesos/          Aumento salarial y simulador
    ├── tablero/, usuarios/, auth/, common/, config/
    ├── database/          Modelos, migraciones y seeders (sequelize-cli)
    ├── main.ts            API
    └── worker.ts          Worker de cálculo (misma imagen, otro punto de entrada)
```

**Cálculo en segundo plano.** La API solo crea el registro en `calculos` y encola el trabajo en Redis
(BullMQ). El worker lo toma, procesa a los empleados por lotes (`WORKER_LOTE`) y guarda el avance;
la pantalla lo consulta cada segundo y medio. Si un worker se cae, BullMQ reintenta y el ejecutor
borra lo que haya dejado el intento anterior. Se escala con más contenedores:

```bash
docker compose up -d --scale worker=3
```

**Motor puro.** `backend/src/motor/` no lee la base ni el reloj: recibe el empleado y las tablas y
devuelve el recibo. Lo usan igual el worker, el simulador y las pruebas. Todo va en centavos enteros.

## Puesta en marcha

La base es el servidor local compartido `~/docker/postgres-bd` (como `mysql-bd` para MySQL), no un
contenedor del proyecto. DBeaver: `localhost:5432`, base `sigenom`, usuario `sigenom` / `sigenom-local`.

```bash
cd ~/docker/postgres-bd && docker compose up -d --wait   # una sola vez
cd -
cp backend/.env.example backend/.env      # captura JWT_SECRET y SEED_ADMIN_PASSWORD
docker compose up -d
docker compose exec backend npm run migrate
docker compose exec backend npm run seed  # catálogos base, usuario ADMIN y datos de ejemplo
```

Aplicación: <http://localhost:4270>. Usuario `ADMIN` con la contraseña de `SEED_ADMIN_PASSWORD`.

`SEED_DATOS_EJEMPLO=true` carga 160 empleados ficticios y la quincena en curso, con casos a propósito
para que Verificación muestre algo. En producción va en `false`.

Pruebas:

```bash
docker compose exec backend npm test
```

## Base de datos

PostgreSQL, normalizada a partir de las 59 tablas de `persona`. Equivalencias principales:

| Progress | SIGenom |
| --- | --- |
| `Empleado`, `Emplea-v`, `Emplea-t` | `empleados` (el tipo de nómina los distingue) |
| `Datos-per`, `Nombres` | `empleados` (nombre separado) y `datos_personales` |
| `Cata-pd` | `conceptos` (con `calculado` para sueldo, ISR, ISSEMYM…) |
| `Pag-des` fijo / `t-m = "Q"` | `empleado_conceptos` / `capturas` |
| `Desc-palim` | `descuentos_plazo` |
| `Apo-des`, `Suc-banc` | `cuentas_contables`, `sucursales_bancarias` |
| `Cata-ispt`, `Tab-cre`, `tabla-rang` | `tabla_isr`, `tabla_subsidio`, `tabulador` (con vigencia) |
| `H-bajas`, `H-permi`, `movp`, `Fum` | `movimientos_personal` |
| `H-mov`, `H-perded` | `bitacora` |
| `Calculos`, `res-qnas`, respaldos `.d` | `periodos`, `calculos`, `recibos`, `recibo_conceptos` |

Las tablas de caja de ahorro, capacitación, comedor, asistencia y servicio social (`Integra`,
`Presta`, `Cursos`, `Asist`, `Serv-soc`…) son otros subsistemas del menú principal y no entran aquí.

## Equivalencia con el sistema anterior

| Menú anterior | Programa | En SIGenom |
| --- | --- | --- |
| Nómina | `1CAP-Q-N` Captura quincenal | Captura y ficha del empleado |
| | `1CAL-N-P` Cálculo de prenómina | Cálculo → Prenómina / Nómina |
| | `1REP-N-P` Reporte de nómina | Reportes → Reporte de nómina |
| | `1DIAG-CA`, `1Diag-ap` Diagnósticos | Verificación |
| | `1LIS-COM`, `1LIS-CHE`, `1REP-CHE` | Pagos y dispersión |
| | `1COM-PAG` Comprobantes de pago | Cálculo / Pagos → Comprobantes en PDF |
| | `1RES-N-A` Resumen por áreas | Reportes → Resumen por áreas presupuestales |
| | `1REP-F-D`, `1R-F-DFR` Firmas diputados | Reportes → Relación para firmas |
| | `1TRA-REI`, `1TRA-I-P` Traspasos | Captura → Importar archivo |
| | `1MEN-ISS`: `1DED-ISS`, `1TRA-SCI` | Reportes → Deducciones ISSEMYM / Póliza |
| | `1TRA-C-N` Transf. a contabilidad | Reportes → Póliza para contabilidad y presupuesto |
| Menú 2 | `dcon-per`, `1VERI-PERM` Permisos | Movimientos / Reportes → Permisos |
| | `1Canc-ba`, `1canc-pe` Cancelar baja/permiso | Movimientos → Cancelar |
| | `1REP-P-G`, `1REP-M-I`, `1REP-M-C` ISR | Reportes → ISR retenido / Acumulado anual |
| | `1cal-a-p` Aguinaldo y prima | Cálculo → Aguinaldo / Prima vacacional |
| | `1cal-a-s` Aumento salarial | Aumento salarial |
| | `DCON-C-T` Costo por tipo | Reportes → Costo por concepto |
| | `1VERI-CA` Verificar cálculos | Verificación (neto negativo, variación) |
| | `MENU-T-B`: `1TRA-BAN`, `1TRA-CLABE` | Pagos → Archivo para el banco |
| | `1RE-E-CB` Empleados con cuenta | Reportes / Verificación |
| | `EXTRAC-E` Extracción ISPT | Reportes → ISR retenido en el mes |
| | `men-resp`, `BOR-CAR-EP` Respaldo / recuperar | Quincenas (cerrar guarda todo; no hay que respaldar) |
| Catálogos | `1ABC-*` (11 programas) | Catálogos (una pantalla genérica) |
| | `1ABC-PEN`, `1ABC-PA`, `1ABC-SUC` | Ficha del empleado → Descuentos / Cuentas |
| Otros | `1SLD-EST`, `AJUSTE` Estimar sueldo | Estimador de sueldo |
| | `PASSWORD.P` Contraseña por menú | Usuarios y roles |

## Pendiente de validar con el área usuaria

El motor reproduce el orden de `1CAL-N-P.W`, pero estas reglas se tomaron de la ley vigente o se
dejaron configurables, y hay que confirmarlas contra una quincena real del sistema anterior:

- **Tarifa ISR y subsidio.** El seed trae la tarifa quincenal publicada desde 2023 y el subsidio fijo
  de 2025. Revisa el Anexo 8 de la RMF vigente. El sistema anterior multiplicaba el subsidio por 0.56
  (ajuste de 2005) y restaba "crédito al salario"; aquí se aplica la regla actual: el subsidio solo
  reduce el ISR.
- **ISSEMYM.** Tasas (4.625 % salud, 6.1 % pensiones), tope y qué conceptos cotizan (`factor_issemym`)
  están en Catálogos.
- **Días.** Quincena comercial de 15 días; altas, bajas y permisos proporcionales a días naturales.
- **Aguinaldo y prima.** 40 días de aguinaldo, 10 de vacaciones al 25 %, exentos 30 y 15 UMA.
- **Layout Citibanamex.** Portado registro por registro de `1TRA-BAN.W` (218 posiciones por abono).
  Captura en Parámetros el cliente, la sucursal y la cuenta de cargo, y valida un archivo de prueba
  con el banco antes del primer pago.
- **Conceptos.** El seed trae un juego de claves de ejemplo. Hay que cargar las reales de `Cata-pd`.

## Migración de datos

No incluida todavía. El camino: exportar las tablas de `persona` con `EXPORT` de Progress (o por
ODBC), y un script que cargue catálogos, empleados y conceptos fijos en este esquema. Con una
quincena del sistema anterior cargada en paralelo se compara recibo por recibo antes de cambiar.

## Pasar a producción

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend npm run migrate
docker compose -f docker-compose.prod.yml exec backend npm run seed   # con SEED_DATOS_EJEMPLO=false
```

La imagen del frontend se compila para `/nomina/`: el proxy del servidor debe quitar ese prefijo
antes de llegar al contenedor (puerto 8081). PostgreSQL va en su propio servidor (`DB_HOST`).
