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

function fmt(n: number): string { return formatNumber(n); }

function getLogoPath(): string | null {
  for (const p of [
    path.join(__dirname, '..', 'templates', 'billkaro-logo.png'),
    path.join(__dirname, 'templates', 'billkaro-logo.png'),
    path.join(process.cwd(), 'dist', 'templates', 'billkaro-logo.png'),
  ]) { if (fs.existsSync(p)) return p; }
  return null;
}

/**
 * Generate a clean, professional invoice PDF
 * Reference: standard invoice layout with wide margins
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 60 });
      const chunks: Uint8Array[] = [];
      doc.on('data', (c: Uint8Array) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Page dimensions with safe margins
      const M = 60;                  // margin
      const PW = 595.28;             // A4 width
      const CW = PW - M * 2;        // content width = 475.28
      const LX = M;                  // left x
      const RX = PW - M;            // right x

      // ── Colors ──
      const blue = '#2563eb';
      const dark = '#1f2937';
      const gray = '#6b7280';
      const lightGray = '#9ca3af';
      const border = '#e5e7eb';
      const bgLight = '#f9fafb';
      const white = '#ffffff';

      // ══════════════════════════════════════════════════════
      // TOP BAR
      // ══════════════════════════════════════════════════════
      doc.rect(0, 0, PW, 5).fill(blue);

      let y = 30;

      // ══════════════════════════════════════════════════════
      // HEADER: Business Name (left) + INVOICE label (right)
      // ══════════════════════════════════════════════════════
      doc.fontSize(18).font('Helvetica-Bold').fillColor(dark)
        .text(data.businessName, LX, y);

      doc.fontSize(22).font('Helvetica-Bold').fillColor(blue)
        .text('INVOICE', LX, y, { width: CW, align: 'right' });

      y += 28;

      // Business address & details
      if (data.businessAddress) {
        doc.fontSize(8).font('Helvetica').fillColor(gray)
          .text(data.businessAddress, LX, y);
        y += 12;
      }

      const details: string[] = [];
      if (data.businessGstin) details.push(`GSTIN: ${data.businessGstin}`);
      details.push(`Ph: ${data.businessPhone}`);
      if (data.businessUpiId) details.push(`UPI: ${data.businessUpiId}`);
      doc.fontSize(7).font('Helvetica').fillColor(lightGray)
        .text(details.join('  •  '), LX, y);

      // Invoice # (right aligned, below INVOICE)
      doc.fontSize(10).font('Helvetica-Bold').fillColor(dark)
        .text(`# ${data.invoiceNo}`, LX, y - 5, { width: CW, align: 'right' });

      y += 22;

      // Divider
      doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.75).stroke();

      // ══════════════════════════════════════════════════════
      // BILL TO (left) + DATES (right)
      // ══════════════════════════════════════════════════════
      y += 15;

      doc.fontSize(7).font('Helvetica-Bold').fillColor(lightGray).text('BILL TO:', LX, y);
      y += 12;
      doc.fontSize(13).font('Helvetica-Bold').fillColor(dark).text(data.clientName, LX, y);
      y += 18;
      if (data.clientPhone) {
        doc.fontSize(8).font('Helvetica').fillColor(gray).text(`Ph: ${data.clientPhone}`, LX, y);
        y += 12;
      }
      if (data.clientGstin) {
        doc.fontSize(8).font('Helvetica').fillColor(gray).text(`GSTIN: ${data.clientGstin}`, LX, y);
        y += 12;
      }

      // Dates on the right
      const dateY = y - (data.clientPhone ? 30 : 18);
      doc.fontSize(8).font('Helvetica').fillColor(gray)
        .text(`Date: ${formatDateNumeric(data.createdAt)}`, LX, dateY, { width: CW, align: 'right' });
      doc.text(`Due: ${formatDateNumeric(data.dueDate)}`, LX, dateY + 14, { width: CW, align: 'right' });

      y += 12;

      // ══════════════════════════════════════════════════════
      // LINE ITEMS TABLE
      // ══════════════════════════════════════════════════════

      // Simple 4-column layout: Description | Qty | Unit Cost | Total
      // CW = ~475. Let's split:
      //   Desc = 235, Qty = 55, Rate = 85, Total = 100
      const descX = LX;
      const qtyX  = LX + 235;
      const rateX = LX + 290;
      const totX  = LX + 375;
      const totW  = RX - totX;   // = ~100

      // Header row
      const hdrH = 28;
      doc.rect(LX, y, CW, hdrH).fill('#374151');
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(white);
      doc.text('DESCRIPTION', descX + 12, y + 9);
      doc.text('QTY', qtyX, y + 9, { width: 50, align: 'center' });
      doc.text('UNIT COST', rateX, y + 9, { width: 80, align: 'right' });
      doc.text('TOTAL', totX, y + 9, { width: totW, align: 'right' });
      y += hdrH;

      // Data rows
      const rowH = 30;
      data.lineItems.forEach((item, i) => {
        // Alternating bg
        if (i % 2 === 0) {
          doc.rect(LX, y, CW, rowH).fill(bgLight);
        }
        // Left accent bar
        doc.rect(LX, y, 3, rowH).fill(blue);

        doc.fontSize(9).font('Helvetica').fillColor(dark);
        doc.text(item.name, descX + 12, y + 9, { width: 220 });
        doc.text(`${item.quantity}`, qtyX, y + 9, { width: 50, align: 'center' });
        doc.text(`Rs. ${fmt(item.rate)}`, rateX, y + 9, { width: 80, align: 'right' });
        doc.font('Helvetica-Bold').fillColor(blue)
          .text(`Rs. ${fmt(item.amount)}`, totX, y + 9, { width: totW, align: 'right' });
        y += rowH;
      });

      // Bottom border of table
      doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();

      // ══════════════════════════════════════════════════════
      // SUBTOTALS (right-aligned, same width as last 2 cols)
      // ══════════════════════════════════════════════════════
      y += 12;

      const sLblX = rateX;       // label column
      const sLblW = 80;
      const sValX = totX;        // value column
      const sValW = totW;

      // Subtotal
      doc.fontSize(8.5).font('Helvetica').fillColor(gray)
        .text('Subtotal:', sLblX, y, { width: sLblW, align: 'right' });
      doc.fillColor(dark)
        .text(`Rs. ${fmt(data.subtotal)}`, sValX, y, { width: sValW, align: 'right' });

      // Taxes
      if (data.gstRate > 0) {
        const half = data.gstAmount / 2;
        y += 16;
        doc.fillColor(gray).text(`CGST (${data.gstRate / 2}%):`, sLblX, y, { width: sLblW, align: 'right' });
        doc.fillColor(dark).text(`Rs. ${fmt(half)}`, sValX, y, { width: sValW, align: 'right' });
        y += 16;
        doc.fillColor(gray).text(`SGST (${data.gstRate / 2}%):`, sLblX, y, { width: sLblW, align: 'right' });
        doc.fillColor(dark).text(`Rs. ${fmt(half)}`, sValX, y, { width: sValW, align: 'right' });
      }

      // Thank you + TOTAL DUE
      y += 22;
      doc.fontSize(8).font('Helvetica-Oblique').fillColor(gray)
        .text('Thank you for your business!', LX, y + 2);

      doc.fontSize(11).font('Helvetica-Bold').fillColor(dark)
        .text('TOTAL DUE:', sLblX - 40, y, { width: sLblW + 40, align: 'right' });

      // Total amount in a rounded box
      const totalText = `Rs. ${fmt(data.totalAmount)}`;
      doc.roundedRect(sValX - 5, y - 4, sValW + 10, 22, 4)
        .strokeColor(blue).lineWidth(1.5).stroke();
      doc.fontSize(11).font('Helvetica-Bold').fillColor(blue)
        .text(totalText, sValX, y, { width: sValW, align: 'right' });

      // Amount in words
      y += 28;
      doc.fontSize(7).font('Helvetica-Oblique').fillColor(lightGray)
        .text(`Rupees ${numberToWords(data.totalAmount)} Only`, LX, y);

      // ══════════════════════════════════════════════════════
      // PAYMENT INFORMATION
      // ══════════════════════════════════════════════════════
      y += 20;
      doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
      y += 10;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(blue).text('PAYMENT INFORMATION', LX, y);
      y += 14;

      const payTop = y;
      let qrDone = false;

      // QR Code
      if (data.businessUpiId) {
        try {
          const qr = await generateUPIQRCode({
            upiId: data.businessUpiId,
            payeeName: data.businessName,
            amount: data.totalAmount,
            transactionNote: `Invoice ${data.invoiceNo}`,
          });
          if (qr) {
            const buf = Buffer.from(qr.replace(/^data:image\/png;base64,/, ''), 'base64');
            doc.rect(LX, y - 3, 95, 105).fillAndStroke(bgLight, border);
            doc.image(buf, LX + 5, y, { width: 85, height: 85 });
            doc.fontSize(6).font('Helvetica-Bold').fillColor(blue)
              .text('Scan to Pay', LX, y + 88, { width: 95, align: 'center' });
            qrDone = true;
          }
        } catch { /* skip */ }
      }

      const px = qrDone ? LX + 108 : LX;
      let py = payTop;
      const drawDetail = (label: string, value: string) => {
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(gray).text(label, px, py);
        doc.font('Helvetica').fillColor(dark).text(value, px + 65, py);
        py += 13;
      };

      if (data.businessUpiId) drawDetail('UPI ID:', data.businessUpiId);
      if (data.bankAccountNo) {
        if (data.bankAccountName) drawDetail('A/C Name:', data.bankAccountName);
        drawDetail('A/C No:', data.bankAccountNo);
        if (data.bankIfsc) drawDetail('IFSC:', data.bankIfsc);
        if (data.bankName) drawDetail('Bank:', data.bankName);
      }

      y = Math.max(py, payTop + (qrDone ? 108 : 0)) + 8;

      // ══════════════════════════════════════════════════════
      // NOTES
      // ══════════════════════════════════════════════════════
      if (data.notes) {
        doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
        y += 8;
        doc.fontSize(7).font('Helvetica-Bold').fillColor(gray).text('Notes:', LX, y);
        doc.fontSize(7).font('Helvetica').fillColor(dark).text(data.notes, LX + 35, y, { width: CW - 35 });
        y += 18;
      }

      // ══════════════════════════════════════════════════════
      // TERMS & CONDITIONS
      // ══════════════════════════════════════════════════════
      y += 5;
      doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
      y += 6;
      doc.fontSize(6).font('Helvetica-Bold').fillColor(lightGray).text('Terms & Conditions', LX, y);
      y += 9;
      doc.fontSize(5.5).font('Helvetica').fillColor(lightGray)
        .text('1. Payment is due by the date mentioned above.  2. Please include the invoice number in your payment reference.  3. This is a computer-generated invoice.', LX, y, { width: CW });

      // ══════════════════════════════════════════════════════
      // FOOTER WITH LOGO
      // ══════════════════════════════════════════════════════
      y += 20;
      doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
      y += 6;
      doc.rect(LX, y, CW, 32).fill(bgLight);

      const logo = getLogoPath();
      if (logo) {
        try {
          doc.image(logo, LX + 8, y + 2, { height: 28 });
          doc.fontSize(7).font('Helvetica-Bold').fillColor(blue)
            .text('Powered by BillKaro', LX + 115, y + 5);
          doc.fontSize(5.5).font('Helvetica').fillColor(lightGray)
            .text('WhatsApp-First Smart Invoicing for Indian SMEs', LX + 115, y + 16);
        } catch {
          doc.fontSize(7).font('Helvetica-Bold').fillColor(blue).text('Powered by BillKaro', LX + 10, y + 7);
          doc.fontSize(5.5).font('Helvetica').fillColor(lightGray)
            .text('WhatsApp-First Smart Invoicing for Indian SMEs', LX + 10, y + 18);
        }
      } else {
        doc.fontSize(7).font('Helvetica-Bold').fillColor(blue).text('Powered by BillKaro', LX + 10, y + 7);
        doc.fontSize(5.5).font('Helvetica').fillColor(lightGray)
          .text('WhatsApp-First Smart Invoicing for Indian SMEs', LX + 10, y + 18);
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
