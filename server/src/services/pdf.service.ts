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

// Professional color palette
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

function rect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, color: string) {
  doc.rect(x, y, w, h).fill(color);
}

// Load BillKaro logo
function getLogoPath(): string | null {
  const possiblePaths = [
    path.join(__dirname, '..', 'templates', 'billkaro-logo.png'),
    path.join(__dirname, 'templates', 'billkaro-logo.png'),
    path.join(process.cwd(), 'src', 'templates', 'billkaro-logo.png'),
    path.join(process.cwd(), 'dist', 'templates', 'billkaro-logo.png'),
  ];
  for (const p of possiblePaths) {
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
        margins: { top: 40, bottom: 40, left: 50, right: 50 },
        info: {
          Title: `Tax Invoice ${data.invoiceNo}`,
          Author: data.businessName,
          Subject: `Invoice for ${data.clientName}`,
        },
      });

      const chunks: Uint8Array[] = [];
      doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const L = 50;   // left margin
      const R = 545;   // right edge (595.28 - 50)
      const W = R - L;  // usable width = 495

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TOP ACCENT BAR
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      rect(doc, 0, 0, 612, 4, C.primary);

      let y = 22;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // HEADER — Business name + TAX INVOICE
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      // Tax Invoice label (right)
      doc.fontSize(10).font('Helvetica').fillColor(C.primary)
        .text('TAX INVOICE', L, y, { width: W, align: 'right' });

      // Business name (left)
      doc.fontSize(17).font('Helvetica-Bold').fillColor(C.dark)
        .text(data.businessName, L, y, { width: W * 0.65 });

      y += 25;

      // Business details
      if (data.businessAddress) {
        doc.fontSize(8.5).font('Helvetica').fillColor(C.secondary)
          .text(data.businessAddress, L, y, { width: W * 0.65 });
        y += 13;
      }

      const bizMeta: string[] = [];
      if (data.businessGstin) bizMeta.push(`GSTIN: ${data.businessGstin}`);
      bizMeta.push(`Ph: ${data.businessPhone}`);
      if (data.businessUpiId) bizMeta.push(`UPI: ${data.businessUpiId}`);

      doc.fontSize(7.5).font('Helvetica').fillColor(C.light)
        .text(bizMeta.join('  |  '), L, y, { width: W });

      y += 18;
      hline(doc, y, L, R, C.border, 0.75);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // BILL TO + INVOICE DETAILS
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      y += 14;
      const metaStartY = y;

      // Left: Bill To
      doc.fontSize(7).font('Helvetica-Bold').fillColor(C.light)
        .text('BILL TO', L, y);
      y += 12;
      doc.fontSize(12).font('Helvetica-Bold').fillColor(C.dark)
        .text(data.clientName, L, y);
      y += 16;
      if (data.clientPhone) {
        doc.fontSize(8.5).font('Helvetica').fillColor(C.secondary)
          .text(`Phone: ${data.clientPhone}`, L, y);
        y += 12;
      }
      if (data.clientGstin) {
        doc.fontSize(8.5).font('Helvetica').fillColor(C.secondary)
          .text(`GSTIN: ${data.clientGstin}`, L, y);
        y += 12;
      }

      // Right: Invoice details box
      const boxW = 175;
      const boxX = R - boxW;
      const boxH = 72;
      rect(doc, boxX, metaStartY - 4, boxW, boxH, C.headerBg);
      doc.rect(boxX, metaStartY - 4, boxW, boxH).strokeColor(C.borderLight).lineWidth(0.5).stroke();

      const labelX = boxX + 10;
      const valueX = boxX + 70;
      let ry = metaStartY + 6;

      const metaRows = [
        ['Invoice #', data.invoiceNo],
        ['Date', formatDateNumeric(data.createdAt)],
        ['Due Date', formatDateNumeric(data.dueDate)],
      ];
      metaRows.forEach(([label, value]) => {
        doc.fontSize(7.5).font('Helvetica').fillColor(C.secondary)
          .text(`${label}:`, labelX, ry);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(C.dark)
          .text(value, valueX, ry, { width: boxW - 80 });
        ry += 15;
      });

      // Status badge
      ry += 1;
      rect(doc, labelX, ry - 1, 52, 13, '#fef3c7');
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#92400e')
        .text('PENDING', labelX + 5, ry + 1);

      y = Math.max(y, metaStartY + boxH + 8);
      y += 8;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // LINE ITEMS TABLE
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      const colSr   = L;
      const colItem = L + 30;
      const colQty  = L + 280;
      const colRate = L + 340;
      const colAmt  = L + 415;
      const rowH    = 25;

      // Table header
      rect(doc, L, y, W, rowH, C.primary);
      doc.fontSize(7).font('Helvetica-Bold').fillColor(C.white);
      doc.text('#', colSr + 8, y + 8);
      doc.text('DESCRIPTION', colItem, y + 8);
      doc.text('QTY', colQty, y + 8, { width: 50, align: 'center' });
      doc.text('RATE', colRate, y + 8, { width: 65, align: 'right' });
      doc.text('AMOUNT', colAmt, y + 8, { width: 80, align: 'right' });
      y += rowH;

      // Table rows
      data.lineItems.forEach((item, i) => {
        const bg = i % 2 === 0 ? C.white : C.rowAlt;
        rect(doc, L, y, W, rowH, bg);

        doc.fontSize(8.5).font('Helvetica').fillColor(C.text);
        doc.text(`${i + 1}`, colSr + 8, y + 7);
        doc.text(item.name, colItem, y + 7, { width: 240 });
        doc.text(`${item.quantity}`, colQty, y + 7, { width: 50, align: 'center' });
        doc.text(fmt(item.rate), colRate, y + 7, { width: 65, align: 'right' });
        doc.font('Helvetica-Bold').fillColor(C.dark)
          .text(fmt(item.amount), colAmt, y + 7, { width: 80, align: 'right' });

        y += rowH;
      });

      // Bottom border
      hline(doc, y, L, R, C.border, 0.75);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TOTALS (right-aligned)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      y += 10;
      const tLabelX = R - 185;
      const tValueX = R - 85;
      const tValueW = 85;

      // Subtotal
      doc.fontSize(8.5).font('Helvetica').fillColor(C.secondary)
        .text('Subtotal', tLabelX, y, { width: 95, align: 'right' });
      doc.fillColor(C.dark)
        .text(`Rs. ${fmt(data.subtotal)}`, tValueX, y, { width: tValueW, align: 'right' });

      // GST (split CGST/SGST)
      if (data.gstRate > 0) {
        const cgst = data.gstAmount / 2;
        y += 15;
        doc.fontSize(8.5).font('Helvetica').fillColor(C.secondary)
          .text(`CGST (${data.gstRate / 2}%)`, tLabelX, y, { width: 95, align: 'right' });
        doc.fillColor(C.dark)
          .text(`Rs. ${fmt(cgst)}`, tValueX, y, { width: tValueW, align: 'right' });

        y += 15;
        doc.fillColor(C.secondary)
          .text(`SGST (${data.gstRate / 2}%)`, tLabelX, y, { width: 95, align: 'right' });
        doc.fillColor(C.dark)
          .text(`Rs. ${fmt(cgst)}`, tValueX, y, { width: tValueW, align: 'right' });
      }

      // Divider
      y += 13;
      hline(doc, y, tLabelX, R, C.border, 0.5);

      // Grand Total
      y += 7;
      rect(doc, tLabelX - 5, y - 3, (R - tLabelX + 5), 24, C.accent);
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(C.primaryDark)
        .text('TOTAL', tLabelX, y + 3, { width: 95, align: 'right' });
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor(C.primaryDark)
        .text(`Rs. ${fmt(data.totalAmount)}`, tValueX, y + 2, { width: tValueW, align: 'right' });

      // Amount in words
      y += 30;
      doc.fontSize(7.5).font('Helvetica-Oblique').fillColor(C.secondary)
        .text(`Amount: Rupees ${numberToWords(data.totalAmount)} Only`, L, y, { width: W });

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // PAYMENT SECTION
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      y += 22;
      hline(doc, y, L, R, C.borderLight, 0.5);
      y += 10;

      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(C.primary)
        .text('PAYMENT INFORMATION', L, y);
      y += 15;

      let paymentSectionY = y;
      let qrRendered = false;

      // QR Code
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

            rect(doc, L, y - 4, 105, 115, C.headerBg);
            doc.rect(L, y - 4, 105, 115).strokeColor(C.borderLight).lineWidth(0.5).stroke();

            doc.image(qrBuffer, L + 5, y, { width: 95, height: 95 });
            doc.fontSize(6.5).font('Helvetica-Bold').fillColor(C.primary)
              .text('Scan to Pay', L, y + 97, { width: 105, align: 'center' });
            qrRendered = true;
          }
        } catch {
          logger.warn('QR code failed', { invoiceNo: data.invoiceNo });
        }
      }

      // Payment details
      const detailX = qrRendered ? L + 120 : L;
      let dy = paymentSectionY;

      if (data.businessUpiId) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
          .text('UPI ID:', detailX, dy);
        doc.font('Helvetica').fillColor(C.dark)
          .text(data.businessUpiId, detailX + 75, dy);
        dy += 14;
      }

      if (data.bankAccountNo && data.bankIfsc) {
        if (data.bankAccountName) {
          doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
            .text('A/C Name:', detailX, dy);
          doc.font('Helvetica').fillColor(C.dark)
            .text(data.bankAccountName, detailX + 75, dy);
          dy += 14;
        }
        doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
          .text('A/C No:', detailX, dy);
        doc.font('Helvetica').fillColor(C.dark)
          .text(data.bankAccountNo, detailX + 75, dy);
        dy += 14;

        doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
          .text('IFSC:', detailX, dy);
        doc.font('Helvetica').fillColor(C.dark)
          .text(data.bankIfsc, detailX + 75, dy);
        dy += 14;

        if (data.bankName) {
          doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
            .text('Bank:', detailX, dy);
          doc.font('Helvetica').fillColor(C.dark)
            .text(data.bankName, detailX + 75, dy);
          dy += 14;
        }
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // NOTES
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      y = Math.max(dy, paymentSectionY + (qrRendered ? 120 : 0)) + 12;
      if (data.notes) {
        hline(doc, y, L, R, C.borderLight, 0.5);
        y += 8;
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.secondary)
          .text('Notes:', L, y);
        y += 11;
        doc.fontSize(7.5).font('Helvetica').fillColor(C.text)
          .text(data.notes, L, y, { width: W });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TERMS & CONDITIONS
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      const termsY = doc.page.height - 95;
      hline(doc, termsY, L, R, C.borderLight, 0.5);

      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(C.light)
        .text('Terms & Conditions', L, termsY + 5);
      doc.fontSize(6).font('Helvetica').fillColor(C.light)
        .text('1. Payment is due by the date mentioned above.  2. Please include the invoice number in your payment reference.  3. This is a computer-generated invoice.', L, termsY + 16, { width: W });

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // FOOTER WITH LOGO
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      const footerY = doc.page.height - 42;
      rect(doc, 0, footerY - 8, 612, 50, C.headerBg);
      hline(doc, footerY - 8, 0, 612, C.borderLight, 0.5);

      // Try to add BillKaro logo
      const logoPath = getLogoPath();
      if (logoPath) {
        try {
          doc.image(logoPath, L, footerY - 3, { height: 28 });
          doc.fontSize(6).font('Helvetica').fillColor(C.light)
            .text('Powered by BillKaro — WhatsApp-First Smart Invoicing', L + 105, footerY + 5, {
              width: W - 105,
              align: 'right',
            });
        } catch {
          // Fallback to text only if logo fails
          doc.fontSize(6.5).font('Helvetica').fillColor(C.light)
            .text('Powered by BillKaro — WhatsApp-First Smart Invoicing for Indian SMEs', L, footerY + 4, {
              width: W,
              align: 'center',
            });
        }
      } else {
        doc.fontSize(6.5).font('Helvetica').fillColor(C.light)
          .text('Powered by BillKaro — WhatsApp-First Smart Invoicing for Indian SMEs', L, footerY + 4, {
            width: W,
            align: 'center',
          });
      }

      doc.end();
      logger.info('Professional PDF generated', { invoiceNo: data.invoiceNo });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Convert number to Indian English words
 */
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

/**
 * Save PDF — uploads to R2
 */
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
