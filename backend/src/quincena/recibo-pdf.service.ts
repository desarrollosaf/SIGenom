import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CalculosService } from './calculos.service';

type Detalle = Awaited<ReturnType<CalculosService['recibo']>>;

const MONEDA = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const TINTA = '#16201c';
const APAGADO = '#66706b';
const LINEA = '#d9dfdc';
const ACENTO = '#0f6b54';

/** Comprobante de pago (1COM-PAG.W): uno por hoja, o todos los de un cálculo en un solo PDF. */
@Injectable()
export class ReciboPdfService {
  constructor(private readonly calculos: CalculosService) {}

  async uno(id: number): Promise<Buffer> {
    const recibo = await this.calculos.recibo(id);
    return this.documento((doc) => this.pintar(doc, recibo));
  }

  async todos(calculoId: number): Promise<Buffer> {
    const ids = await this.calculos.idsRecibos(calculoId);
    const recibos: Detalle[] = [];
    for (const id of ids) recibos.push(await this.calculos.recibo(id));
    return this.documento((doc) =>
      recibos.forEach((r, i) => {
        if (i > 0) doc.addPage();
        this.pintar(doc, r);
      }),
    );
  }

  private documento(pintar: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: 'Comprobante de pago', Author: 'SIGenom' } });
      const partes: Buffer[] = [];
      doc.on('data', (p: Buffer) => partes.push(p));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      pintar(doc);
      doc.end();
    });
  }

  private pintar(doc: PDFKit.PDFDocument, r: Detalle) {
    const ancho = doc.page.width - 96;
    const x = 48;

    doc.fillColor(ACENTO).fontSize(9).font('Helvetica-Bold').text('COMPROBANTE DE PAGO', x, 48);
    doc.fillColor(TINTA).fontSize(18).font('Helvetica').text(r.nombre, x, 64, { width: ancho });
    doc.fillColor(APAGADO).fontSize(9).text(`${r.periodo.nombre}  ·  ${etiquetaTipo(r.calculo.tipo)}  ·  pago ${fechaCorta(r.periodo.fechaPago)}`, x, doc.y + 2);

    // Datos del empleado en dos columnas.
    const datos: [string, string][] = [
      ['CURP', r.curp],
      ['RFC', r.rfc],
      ['Adscripción', r.adscripcion],
      ['Puesto', r.puesto],
      ['Nivel / rango', `${r.nivel} / ${r.rango}`],
      ['Días pagados', String(r.dias)],
    ];
    let y = doc.y + 16;
    datos.forEach(([etiqueta, valor], i) => {
      const cx = x + (i % 2) * (ancho / 2);
      const cy = y + Math.floor(i / 2) * 26;
      doc.fillColor(APAGADO).fontSize(7.5).text(etiqueta.toUpperCase(), cx, cy);
      doc.fillColor(TINTA).fontSize(9.5).text(valor, cx, cy + 10, { width: ancho / 2 - 12, ellipsis: true, lineBreak: false });
    });
    y += Math.ceil(datos.length / 2) * 26 + 14;

    // Percepciones y deducciones lado a lado.
    const mitad = (ancho - 24) / 2;
    const columna = (titulo: string, naturaleza: 'P' | 'D', cx: number) => {
      let cy = y;
      doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(9).text(titulo, cx, cy);
      cy += 16;
      doc.moveTo(cx, cy - 4).lineTo(cx + mitad, cy - 4).strokeColor(LINEA).lineWidth(0.8).stroke();
      for (const c of r.conceptos.filter((k) => k.naturaleza === naturaleza)) {
        doc.font('Helvetica').fillColor(APAGADO).fontSize(8).text(String(c.clave).padStart(3, '0'), cx, cy, { width: 24 });
        doc.fillColor(TINTA).fontSize(9).text(c.descripcion, cx + 26, cy, { width: mitad - 120, height: 11, ellipsis: true });
        doc.text(MONEDA.format(c.importe), cx + mitad - 90, cy, { width: 90, align: 'right' });
        cy += 15;
      }
      return cy;
    };
    const fin = Math.max(columna('Percepciones', 'P', x), columna('Deducciones', 'D', x + mitad + 24));

    // Totales.
    let ty = fin + 12;
    doc.moveTo(x, ty).lineTo(x + ancho, ty).strokeColor(LINEA).stroke();
    ty += 10;
    const total = (etiqueta: string, valor: number, cx: number) => {
      doc.fillColor(APAGADO).font('Helvetica').fontSize(8).text(etiqueta.toUpperCase(), cx, ty);
      doc.fillColor(TINTA).fontSize(11).text(MONEDA.format(valor), cx, ty + 11);
    };
    total('Total percepciones', r.totalPercepciones, x);
    total('Total deducciones', r.totalDeducciones, x + ancho / 3);
    doc.fillColor(APAGADO).fontSize(8).text('NETO A PAGAR', x + (2 * ancho) / 3, ty, { width: ancho / 3, align: 'right' });
    doc.fillColor(ACENTO).font('Helvetica-Bold').fontSize(16).text(MONEDA.format(r.neto), x + (2 * ancho) / 3, ty + 10, { width: ancho / 3, align: 'right' });

    const pago = r.pagoCheque ? 'Pago con cheque' : r.cuentaBancaria ? `Depósito a la cuenta terminación ${r.cuentaBancaria.slice(-4)}` : 'Sin cuenta bancaria registrada';
    doc.font('Helvetica').fillColor(APAGADO).fontSize(8)
      .text(`${pago}  ·  Base ISR ${MONEDA.format(r.baseIsr)}  ·  ISR causado ${MONEDA.format(r.isrCausado)}  ·  Subsidio ${MONEDA.format(r.subsidio)}`, x, ty + 40, { width: ancho });
  }
}

/** "2026-11-15" -> "15/11/2026" */
const fechaCorta = (fecha: string | null) => (fecha ? fecha.split('-').reverse().join('/') : '');

const etiquetaTipo = (tipo: string) =>
  ({ prenomina: 'Prenómina', nomina: 'Nómina', aguinaldo: 'Aguinaldo', prima_vacacional: 'Prima vacacional' })[tipo] ?? tipo;
