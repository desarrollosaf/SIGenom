import ExcelJS from 'exceljs';

export interface ColumnaTabla {
  clave: string;
  titulo: string;
  tipo?: 'texto' | 'dinero' | 'numero' | 'fecha';
}

export interface TablaReporte {
  titulo: string;
  subtitulo?: string;
  columnas: ColumnaTabla[];
  filas: Record<string, unknown>[];
  totales?: Record<string, number>;
}

/** Cualquier tabla de reporte a un libro de Excel con encabezado, formato de moneda y totales. */
export async function tablaAExcel(tabla: TablaReporte): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'SIGenom';
  const hoja = libro.addWorksheet(tabla.titulo.slice(0, 31));

  hoja.addRow([tabla.titulo]).font = { bold: true, size: 14 };
  if (tabla.subtitulo) hoja.addRow([tabla.subtitulo]).font = { color: { argb: 'FF666666' } };
  hoja.addRow([]);

  const encabezado = hoja.addRow(tabla.columnas.map((c) => c.titulo));
  encabezado.font = { bold: true };
  encabezado.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F1' } };
    celda.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });

  for (const fila of tabla.filas) hoja.addRow(tabla.columnas.map((c) => fila[c.clave] ?? ''));

  if (tabla.totales) {
    const total = hoja.addRow(
      tabla.columnas.map((c, i) => (i === 0 ? 'Total' : (tabla.totales?.[c.clave] ?? ''))),
    );
    total.font = { bold: true };
  }

  tabla.columnas.forEach((c, i) => {
    const columna = hoja.getColumn(i + 1);
    columna.width = c.tipo === 'dinero' ? 16 : Math.min(48, Math.max(10, c.titulo.length + 4));
    if (c.tipo === 'dinero') columna.numFmt = '"$"#,##0.00';
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
