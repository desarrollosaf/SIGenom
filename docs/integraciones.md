# Otros sistemas

SIGenom lee movimientos de otros sistemas a una bandeja (**Otros sistemas** en el menú). Ahí se revisan y se
aplican o descartan. La lectura es de solo lectura: a los otros sistemas no se les escribe nada.

La conexión se captura en `backend/.env` (`EXT_PERSONAL_*`, `EXT_CHECADOR_*`, `EXT_PRESTAMOS_*`; plantilla en
`.env.example`) y se toma al levantar de nuevo el contenedor: `docker compose up -d`. Los tres se leen de PostgreSQL.
Conviene un usuario que solo tenga `SELECT` sobre la tabla de control.

Reglas para las tres tablas: `id` entero que crece (no se reutiliza) y los renglones no se modifican después de
insertarse; una corrección es un renglón nuevo. La persona se busca por CURP y, si no está, por RFC.

## 1. Personal (SIModpersonal)

Ya existe: `movimientos_historico`, la copia de lo que se transfiere a nómina por lote.

| Tipo | Qué hace en SIGenom |
|---|---|
| `A` NUE | Alta del empleado con su puesto, rango, adscripción y claves fijas |
| `A` REI, RIN | Reingreso, y puesto o adscripción si cambiaron |
| `B` | Baja con el motivo que corresponde al subtipo |
| `P` | Cambio de puesto, nivel o rango, y claves fijas |
| `T` | Cambio de adscripción |
| `L` SIN | Licencia sin goce: no se pagan esos días |
| `L` CON | No cambia el pago; queda registrada |

El nivel sale de los dos últimos dígitos del puesto. Los importes de `percepciones` vienen por mes y se pasan a
quincena. Las claves del tabulador (001, 011, 012) no se toman de ahí: las calcula SIGenom.

## 2. Checadores

Debe dejar las incidencias ya convertidas a importe:

```sql
CREATE TABLE control_incidencias (
  id          bigserial PRIMARY KEY,
  curp        varchar(18),
  rfc         varchar(13),
  nombre      varchar(170),
  tipo_nomina varchar(1),              -- P, H o D; si falta, se busca en todas
  tipo        varchar(20) NOT NULL,    -- falta, retardo, reintegro, estimulo, otro
  clave       smallint,                -- si falta: falta y retardo 551, reintegro 067, estimulo 030
  importe     numeric(12,2) NOT NULL,  -- positivo
  dias        numeric(5,2),
  fecha       date,
  anio        smallint,
  quincena    smallint,                -- 1 a 24
  referencia  varchar(80),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Cada renglón entra como captura de la quincena abierta.

## 3. Préstamos

```sql
CREATE TABLE control_prestamos (
  id                bigserial PRIMARY KEY,
  prestamo          varchar(20) NOT NULL,   -- el mismo número en su alta, cambio y liquidación
  curp              varchar(18),
  rfc               varchar(13),
  nombre            varchar(170),
  tipo_nomina       varchar(1),
  tipo              varchar(20) NOT NULL,   -- alta, cambio, suspension, reanudacion, liquidacion
  clave             smallint,               -- la deducción, en el alta
  importe_quincenal numeric(12,2),          -- en el alta y en el cambio
  quincenas         smallint,               -- las que faltan
  importe           numeric(12,2),          -- saldo a descontar de una vez, en la liquidación
  beneficiario      varchar(120),
  fecha             date,
  anio              smallint,
  quincena          smallint,
  referencia        varchar(80),
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

El alta crea un descuento a plazo; la liquidación lo termina y, si trae `importe`, captura el saldo en la quincena abierta.
