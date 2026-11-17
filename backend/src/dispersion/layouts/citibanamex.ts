/**
 * Layout de pago de nómina Citibanamex, portado de 1TRA-BAN.W (registros 1, 2, 3 y 4).
 *
 * Diferencias a propósito con el original:
 *  - Los centavos se toman del importe completo. El original los cortaba de STRING(tot_v, "99999999.99"),
 *    que se desborda con totales de 100 millones o más.
 *  - Los datos del contrato (cliente, cuenta y sucursal de cargo) se capturan en Parámetros en
 *    lugar de estar escritos en el código.
 *
 * Antes de usarlo en producción hay que validar un archivo de prueba con el banco.
 */

export interface ContratoBanamex {
  cliente: string;
  sucursalCargo: string;
  cuentaCargo: string;
  razonSocial: string;
  descripcion: string;
}

export interface AbonoBanamex {
  nombre: string;
  cuenta: string;
  sucursal: number | null;
  importe: number;
}

const ceros = (n: number) => '0'.repeat(n);
const espacios = (n: number) => ' '.repeat(n);
const num = (valor: number | string, largo: number) => String(valor).replace(/\D/g, '').padStart(largo, '0').slice(-largo);
const txt = (valor: string, largo: number) => valor.padEnd(largo, ' ').slice(0, largo);

/** Importe en 16 enteros + 2 centavos, sin punto. */
const importe = (pesos: number) => {
  const centavos = Math.round(pesos * 100);
  return num(Math.floor(centavos / 100), 16) + num(centavos % 100, 2);
};

/** Ñ por N y punto por espacio, como hacía el original al final del archivo. */
const limpiar = (linea: string) =>
  linea
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/gi, 'N')
    .replace(/\./g, ' ')
    .toUpperCase();

/** Cuentas que el original excluía: las que empiezan con 9 o con 1 y las de últimos 4 dígitos en cero. */
export function cuentaDispersable(cuenta: string | null): boolean {
  if (!cuenta || cuenta.length < 16) return !!cuenta && cuenta.length >= 10;
  if (cuenta.startsWith('9') || cuenta.startsWith('1')) return false;
  return Number(cuenta.slice(12, 16)) > 0;
}

export function archivoBanamex(contrato: ContratoBanamex, fecha: string, secuencia: number, abonos: AbonoBanamex[]): string {
  const [anio, mes, dia] = fecha.split('-');
  const total = abonos.reduce((s, a) => s + Math.round(a.importe * 100), 0) / 100;
  const lineas: string[] = [];

  // 1. Registro de control.
  lineas.push(
    '1' + num(contrato.cliente, 12) + dia + mes + anio.slice(2) + num(secuencia, 4) +
      txt(contrato.razonSocial, 36) + txt(contrato.descripcion, 20) + '05' + espacios(40) + 'B' + '0' + '1',
  );

  // 2. Registro global (cargo).
  lineas.push('2' + '1' + '001' + importe(total) + '01' + num(contrato.sucursalCargo, 4) + num(contrato.cuentaCargo, 20) + espacios(20));

  // 3. Abonos individuales.
  abonos.forEach((abono, i) => {
    const cuenta = abono.cuenta.padStart(16, '0');
    const tarjeta = cuenta.startsWith('5');
    const tipoCuenta = tarjeta ? '03' : '01';
    let destino: string;
    if (cuenta.startsWith('2')) {
      // Cuenta de cheques con sucursal dentro del número (posiciones 5-8 y 9-15).
      destino = cuenta.slice(4, 8) + ceros(4) + ceros(9) + cuenta.slice(8, 15);
    } else {
      const sucursal = tarjeta ? '0000' : num(abono.sucursal ?? 0, 4);
      destino = sucursal + ceros(4) + cuenta;
    }
    lineas.push(
      '3' + '0' + '001' + importe(abono.importe) + tipoCuenta + destino + num(i + 1, 10) + espacios(30) + txt(abono.nombre, 55) + espacios(64) + ceros(10),
    );
  });

  // 4. Totales.
  lineas.push('4' + '001' + num(abonos.length, 6) + importe(total) + '000001' + importe(total));

  return lineas.map(limpiar).join('\r\n') + '\r\n';
}
