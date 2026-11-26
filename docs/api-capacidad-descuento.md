# Capacidad de descuento (API para otros sistemas)

Dice cuánto se le puede descontar a una persona por préstamos, a partir de su último recibo pagado.

## Cómo se pide

```
POST http://192.168.108.250:3098/consulta/capacidad-descuento
x-api-key: <llave que entrega nómina>
Content-Type: application/json

{ "curp": "XEXX010101HNEXXXA4" }
```

```bash
curl -X POST http://192.168.108.250:3098/consulta/capacidad-descuento \
  -H 'x-api-key: LA_LLAVE' -H 'Content-Type: application/json' \
  -d '{"curp":"XEXX010101HNEXXXA4"}'
```

La CURP va en el cuerpo y no en la dirección, para que no quede en bitácoras de servidores ni en historiales.

## Cómo se calcula

1. Se toma su **último recibo pagado** de cada nómina en que cobra (SIGenom o el sistema anterior).
2. **Ingreso** = 001 + 011 + 012 + 014 + 017 + 034; la clave que no tiene no suma.
3. **Neto** = ingreso − **todas** sus deducciones de ese recibo, tal cual.
4. **Máximo a descontar** = 30 % del neto, redondeado hacia abajo al centavo. Si el neto es negativo, o la
   persona está dada de baja en esa nómina, es 0.

Todos los importes son **por quincena**.

## Respuesta

```json
{
  "curp": "XEXX010101HNEXXXA4",
  "nombre": "NOMBRE APELLIDO",
  "claves": [1, 11, 12, 14, 17, 34],
  "nominas": [
    {
      "nomina": "P",
      "activo": true,
      "recibo": { "anio": 2025, "quincena": 24, "fuente": "sistema anterior" },
      "percepciones": [
        { "clave": 1, "descripcion": "SUELDO", "importe": 8099.85 },
        { "clave": 17, "descripcion": "GRATIFICACION EXTRAORDINARIA", "importe": 2218.95 }
      ],
      "totalPercepciones": 15818.70,
      "totalDeducciones": 4189.58,
      "neto": 11629.12,
      "porcentaje": 30,
      "maximoDescuento": 3488.73
    }
  ],
  "maximoDescuento": 3488.73
}
```

- `nominas`: una por cada nómina en que la persona tiene recibo (P principal, D diputados, H honorarios).
- `maximoDescuento` de afuera: la suma de todas sus nóminas.
- `recibo`: de qué quincena salió el cálculo. Conviene mostrarlo a quien autoriza el préstamo.

| Código | Qué pasó |
|---|---|
| 200 | Listo |
| 400 | La CURP no tiene formato válido |
| 401 | Falta la llave o no es la correcta |
| 404 | No hay nadie con esa CURP, o todavía no tiene un recibo pagado |
| 503 | En el servidor de nómina falta configurar `CONSULTA_API_LLAVE` |

Cada consulta queda en la bitácora de SIGenom (quién preguntó, desde qué equipo y qué se respondió).
