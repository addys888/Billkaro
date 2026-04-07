import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { formatNumber } from '../utils/currency';
import { formatDateNumeric } from '../utils/dates';
import { generateUPIQRCode } from '../utils/upi';
import { uploadToR2 } from './storage.service';

interface InvoiceData {
  invoiceNo: string;
  createdAt: Date;
  dueDate: Date;
  businessName: string;
  businessAddress?: string;
  businessGstin?: string;
  businessPhone: string;
  businessUpiId?: string;
  clientName: string;
  clientPhone?: string;
  clientGstin?: string;
  lineItems: Array<{
    name: string;
    quantity: number;
    rate: number;
    amount: number;
  }>;
  subtotal: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;
  notes?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  bankAccountName?: string;
  bankName?: string;
}

const C = {
  primary: '#2563eb',
  primaryDark: '#1e40af',
  dark: '#1f2937',
  text: '#374151',
  secondary: '#6b7280',
  light: '#9ca3af',
  border: '#d1d5db',
  borderLight: '#e5e7eb',
  white: '#ffffff',
  headerBg: '#f8fafc',
  rowAlt: '#f9fafb',
  accent: '#dbeafe',
};

function fmt(amount: number): string {
  return formatNumber(amount);
}

function hline(doc: PDFKit.PDFDocument, y: number, x1: number, x2: number, color = C.borderLight, width = 0.5) {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke();
}

function filledRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, color: string) {
  doc.rect(x, y, w, h).fill(color);
}

function getLogoPath(): string | null {
  const paths = [
    path.join(__dirname, '..', 'templates', 'billkaro-logo.png'),
    path.join(__dirname, 'templates', 'billkaro-logo.png'),
    path.join(process.cwd(), 'src', 'templates', 'billkaro-logo.png'),
    path.join(process.cwd(), 'dist', 'templates', 'billkaro-logo.png'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Generate a professional GST-compliant invoice PDF
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 55, right: 55 },
        info: {
          Title: `Tax Invoice ${data.invoiceNo}`,
          Author: data.businessName,
        },
      });

      const chunks: Uint8Array[] = [];
      doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // A4 = 595.28 x 841.89 points
      const L = 55;       // left margin
      const R = 540;      // right edge (595 - 55)
      const W = R - L;    // usable = 485

      // ════════════════════════════════════════════════════
      // ACCENT BAR
      // ════════════════════════════════════════════════════
      filledRect(doc, 0, 0, 595, 4, C.primary);

      let y = 22;

      // ════════════════════════════════════════════════════
      // HEADER
      // ════════════════════════════════════════════════════
      doc.fontSize(10).font('Helvetica').fillColor(C.primary)
        .text('TAX INVOICE', L, y, { width: W, align: 'right' });

      doc.fontSize(16).font('Helvetica-Bold').fillColor(C.dark)
        .text(data.businessName, L, y, { width: W * 0.6 });

      y += 24;
      if (data.businessAddress) {
        doc.fontSize(8).font('Helvetica').fillColor(C.secondary)
          .text(data.businessAddress, L, y, { width: W * 0.6 });
        y += 12;
      }

      const meta: string[] = [];
      if (data.businessGstin) meta.push(`GSTIN: ${data.businessGstin}`);
      meta.push(`Ph: ${data.businessPhone}`);
      if (data.businessUpiId) meta.push(`UPI: ${data.businessUpiId}`);
      doc.fontSize(7).font('Helvetica').fillColor(C.light)
        .text(meta.join('  |  '), L, y, { width: W });

      y += 16;
      hline(doc, y, L, R, C.border, 0.75);

      // ════════════════════════════════════════════════════
      // BILL TO + INVOICE DETAILS
      // ════════════════════════════════════════════════════
      y += 12;
      const topY = y;

      // Left — Bill To
      doc.fontSize(7).font('Helvetica-Bold').fillColor(C.light).text('BILL TO', L, y);
      y += 11;
      doc.fontSize(12).font('Helvetica-Bold').fillColor(C.dark).text(data.clientName, L, y);
      y += 16;
      if (data.clientPhone) {
        doc.fontSize(8).font('Helvetica').fillColor(C.secondary).text(`Ph: ${data.clientPhone}`, L, y);
        y += 11;
      }
      if (data.clientGstin) {
        doc.fontSize(8).font('Helvetica').fillColor(C.secondary).text(`GSTIN: ${data.clientGstin}`, L, y);
        y += 11;
      }

      // Right — Invoice box
      const bxW = 170;
      const bxX = R - bxW;
      const bxH = 68;
      filledRect(doc, bxX, topY - 3, bxW, bxH, C.headerBg);
      doc.rect(bxX, topY - 3, bxW, bxH).strokeColor(C.borderLight).lineWidth(0.5).stroke();

      let ry = topY + 6;
      const lx = bxX + 10;
      const vx = bxX + 68;
      [['Invoice #', data.invoiceNo], ['Date', formatDateNumeric(data.createdAt)], ['Due Date', formatDateNumeric(data.dueDate)]].forEach(([l, v]) => {
        doc.fontSize(7).font('Helvetica').fillColor(C.secondary).text(`${l}:`, lx, ry);
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.dark).text(v as string, vx, ry, { width: bxW - 78 });
        ry += 14;
      });
      ry += 1;
      filledRect(doc, lx, ry, 48, 12, '#fef3c7');
      doc.fontSize(6).font('Helvetica-Bold').fillColor('#92400e').text('PENDING', lx + 5, ry + 2);

      y = Math.max(y, topY + bxH + 5) + 8;

      // ════════════════════════════════════════════════════
      // LINE ITEMS TABLE
      // ════════════════════════════════════════════════════
      //
      // Column layout (total = 485):
      //   # = 25,  Description = 220,  Qty = 55,  Rate = 85,  Amount = 100
      //
      const c0 = L;           // # start
      const c1 = L + 25;      // Description start
      const c2 = L + 245;     // Qty start
      const c3 = L + 300;     // Rate start
      const c4 = L + 385;     // Amount start
      const c4w = R - c4;     // Amount width = 155 (plenty of room)
      const rH = 24;

      // Header
      filledRect(doc, L, y, W, rH, C.primary);
      doc.fontSize(7).font('Helvetica-Bold').fillColor(C.white);
      doc.text('#', c0 + 7, y + 7);
      doc.text('DESCRIPTION', c1, y + 7);
      doc.text('QTY', c2, y + 7, { width: 50, align: 'center' });
      doc.text('RATE (Rs.)', c3, y + 7, { width: 80, align: 'right' });
      doc.text('AMOUNT (Rs.)', c4, y + 7, { width: c4w, align: 'right' });
      y += rH;

      // Rows
      data.lineItems.forEach((item, i) => {
        filledRect(doc, L, y, W, rH, i % 2 === 0 ? C.white : C.rowAlt);
        doc.fontSize(8).font('Helvetica').fillColor(C.text);
        doc.text(`${i + 1}`, c0 + 7, y + 7);
        doc.text(item.name, c1, y + 7, { width: 215 });
        doc.text(`${item.quantity}`, c2, y + 7, { width: 50, align: 'center' });
        doc.text(fmt(item.rate), c3, y + 7, { width: 80, align: 'right' });
        doc.font('Helvetica-Bold').fillColor(C.dark)
          .text(fmt(item.amount), c4, y + 7, { width: c4w, align: 'right' });
        y += rH;
      });
      hline(doc, y, L, R, C.border, 0.75);

      // ════════════════════════════════════════════════════
      // TOTALS
      // ════════════════════════════════════════════════════
      y += 8;
      const tLbl = c3;        // label column = Rate column
      const tLblW = 80;
      const tVal = c4;        // value column = Amount column
      const tValW = c4w;

      doc.fontSize(8).font('Helvetica').fillColor(C.secondary)
        .text('Subtotal', tLbl, y, { width: tLblW, align: 'right' });
      doc.fillColor(C.dark)
        .text(`Rs. ${fmt(data.subtotal)}`, tVal, y, { width: tValW, align: 'right' });

      if (data.gstRate > 0) {
        const half = data.gstAmount / 2;
        y += 14;
        doc.fillColor(C.secondary).text(`CGST (${data.gstRate / 2}%)`, tLbl, y, { width: tLblW, align: 'right' });
        doc.fillColor(C.dark).text(`Rs. ${fmt(half)}`, tVal, y, { width: tValW, align: 'right' });
        y += 14;
        doc.fillColor(C.secondary).text(`SGST (${data.gstRate / 2}%)`, tLbl, y, { width: tLblW, align: 'right' });
        doc.fillColor(C.dark).text(`Rs. ${fmt(half)}`, tVal, y, { width: tValW, align: 'right' });
      }

      y += 12;
      hline(doc, y, tLbl, R, C.border, 0.5);
      y += 6;

      // Total bar
      const totalBarX = tLbl - 5;
      filledRect(doc, totalBarX, y - 2, R - totalBarX, 22, C.accent);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.primaryDark)
        .text('TOTAL', tLbl, y + 3, { width: tLblW, align: 'right' });
      doc.fontSize(10).font('Helvetica-Bold').fillColor(C.primaryDark)
        .text(`Rs. ${fmt(data.totalAmount)}`, tVal, y + 2, { width: tValW, align: 'right' });

      y += 28;
      doc.fontSize(7).font('Helvetica-Oblique').fillColor(C.secondary)
        .text(`Amount: Rupees ${numberToWords(data.totalAmount)} Only`, L, y, { width: W });

      // ════════════════════════════════════════════════════
      // PAYMENT INFORMATION (flows naturally)
      // ════════════════════════════════════════════════════
      y += 20;
      hline(doc, y, L, R, C.border, 0.5);
      y += 10;

      doc.fontSize(8).font('Helvetica-Bold').fillColor(C.primary).text('PAYMENT INFORMATION', L, y);
      y += 14;

      const payStartY = y;
      let qrRendered = false;

      if (data.businessUpiId) {
        try {
          const qrDataUrl = await generateUPIQRCode({
            upiId: data.businessUpiId,
            payeeName: data.businessName,
            amount: data.totalAmount,
            transactionNote: `Invoice ${data.invoiceNo}`,
          });
          if (qrDataUrl) {
            const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
            const qrBuffer = Buffer.from(qrBase64, 'base64');

            filledRect(doc, L, y - 3, 100, 110, C.headerBg);
            doc.rect(L, y - 3, 100, 110).strokeColor(C.borderLight).lineWidth(0.5).stroke();
            doc.image(qrBuffer, L + 5, y, { width: 90, height: 90 });
            doc.fontSize(6).font('Helvetica-Bold').fillColor(C.primary)
              .text('Scan to Pay', L, y + 93, { width: 100, align: 'center' });
            qrRendered = true;
          }
        } catch {
          logger.warn('QR code failed', { invoiceNo: data.invoiceNo });
        }
      }

      // Payment details (right of QR or left if no QR)
      const dX = qrRendered ? L + 115 : L;
      let dY = payStartY;

      if (data.businessUpiId) {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.text).text('UPI ID:', dX, dY);
        doc.font('Helvetica').fillColor(C.dark).text(data.businessUpiId, dX + 65, dY);
        dY += 13;
      }
      if (data.bankAccountNo && data.bankIfsc) {
        if (data.bankAccountName) {
          doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.text).text('A/C Name:', dX, dY);
          doc.font('Helvetica').fillColor(C.dark).text(data.bankAccountName, dX + 65, dY);
          dY += 13;
        }
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.text).text('A/C No:', dX, dY);
        doc.font('Helvetica').fillColor(C.dark).text(data.bankAccountNo, dX + 65, dY);
        dY += 13;
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.text).text('IFSC:', dX, dY);
        doc.font('Helvetica').fillColor(C.dark).text(data.bankIfsc, dX + 65, dY);
        dY += 13;
        if (data.bankName) {
          doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.text).text('Bank:', dX, dY);
          doc.font('Helvetica').fillColor(C.dark).text(data.bankName, dX + 65, dY);
          dY += 13;
        }
      }

      // Move Y past the payment section
      y = Math.max(dY, payStartY + (qrRendered ? 115 : 0)) + 8;

      // ════════════════════════════════════════════════════
      // NOTES (flows naturally)
      // ════════════════════════════════════════════════════
      if (data.notes) {
        hline(doc, y, L, R, C.borderLight, 0.5);
        y += 8;
        doc.fontSize(7).font('Helvetica-Bold').fillColor(C.secondary).text('Notes:', L, y);
        y += 10;
        doc.fontSize(7).font('Helvetica').fillColor(C.text).text(data.notes, L, y, { width: W });
        y += 15;
      }

      // ════════════════════════════════════════════════════
      // TERMS & CONDITIONS (flows right after content)
      // ════════════════════════════════════════════════════
      y += 5;
      hline(doc, y, L, R, C.borderLight, 0.5);
      y += 6;
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(C.light).text('Terms & Conditions', L, y);
      y += 10;
      doc.fontSize(6).font('Helvetica').fillColor(C.light)
        .text('1. Payment is due by the date mentioned above.', L, y, { width: W });
      y += 9;
      doc.text('2. Please include the invoice number in your payment reference.', L, y, { width: W });
      y += 9;
      doc.text('3. This is a computer-generated invoice.', L, y, { width: W });

      // ════════════════════════════════════════════════════
      // FOOTER WITH LOGO (flows after terms)
      // ════════════════════════════════════════════════════
      y += 18;
      hline(doc, y, L, R, C.border, 0.5);
      y += 8;

      filledRect(doc, L, y - 3, W, 36, C.headerBg);

      const logoPath = getLogoPath();
      if (logoPath) {
        try {
          doc.image(logoPath, L + 5, y, { height: 30 });
          doc.fontSize(6.5).font('Helvetica').fillColor(C.secondary)
            .text('Powered by BillKaro', L + 120, y + 6)
            .fontSize(5.5).fillColor(C.light)
            .text('WhatsApp-First Smart Invoicing for Indian SMEs', L + 120, y + 17);
        } catch {
          doc.fontSize(7).font('Helvetica-Bold').fillColor(C.primary)
            .text('BillKaro', L + 10, y + 6)
            .fontSize(5.5).font('Helvetica').fillColor(C.light)
            .text('WhatsApp-First Smart Invoicing for Indian SMEs', L + 10, y + 17);
        }
      } else {
        doc.fontSize(7).font('Helvetica-Bold').fillColor(C.primary)
          .text('BillKaro', L + 10, y + 6)
          .fontSize(5.5).font('Helvetica').fillColor(C.light)
          .text('Powered by BillKaro — WhatsApp-First Smart Invoicing for Indian SMEs', L + 10, y + 17);
      }

      doc.end();
      logger.info('PDF generated', { invoiceNo: data.invoiceNo });
    } catch (error) {
      reject(error);
    }
  });
}

function numberToWords(num: number): string {
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const whole = Math.floor(num);
  const paise = Math.round((num - whole) * 100);

  function convert(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }

  let result = convert(whole);
  if (paise > 0) result += ` and ${convert(paise)} Paise`;
  return result;
}

export async function savePDF(invoiceNo: string, pdfBuffer: Buffer): Promise<string> {
  const key = `invoices/${invoiceNo}.pdf`;
  try {
    const url = await uploadToR2(pdfBuffer, key, 'application/pdf');
    logger.info('PDF saved', { invoiceNo, url });
    return url;
  } catch (error: any) {
    logger.error('PDF save failed', { invoiceNo, errorMessage: error?.message });
    throw error;
  }
}

export async function savePDFLocally(invoiceNo: string, pdfBuffer: Buffer): Promise<string> {
  return savePDF(invoiceNo, pdfBuffer);
}
