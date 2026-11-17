const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Hoy en México, "AAAA-MM-DD", sin importar la zona del servidor. */
export const hoyMexico = (): string => FORMATO.format(new Date());

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "1ª quincena de noviembre 2026" */
export function nombreQuincena(anio: number, quincena: number): string {
  const mes = MESES[Math.ceil(quincena / 2) - 1];
  return `${quincena % 2 === 1 ? '1ª' : '2ª'} quincena de ${mes} ${anio}`;
}
