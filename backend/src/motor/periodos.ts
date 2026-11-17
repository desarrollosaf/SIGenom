/** Fechas de la quincena `quincena` (1 a 24) del año: la impar del 1 al 15, la par del 16 al fin de mes. */
export function fechasDeQuincena(anio: number, quincena: number) {
  if (quincena < 1 || quincena > 24) throw new Error('La quincena va de 1 a 24');
  const mes = Math.ceil(quincena / 2);
  const primera = quincena % 2 === 1;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dd = (d: number) => `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return {
    inicio: dd(primera ? 1 : 16),
    fin: dd(primera ? 15 : ultimoDia),
  };
}

/** Quincena que contiene una fecha "AAAA-MM-DD". */
export function quincenaDeFecha(fecha: string) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return { anio, quincena: (mes - 1) * 2 + (dia <= 15 ? 1 : 2) };
}

export function siguienteQuincena(anio: number, quincena: number) {
  return quincena === 24 ? { anio: anio + 1, quincena: 1 } : { anio, quincena: quincena + 1 };
}
