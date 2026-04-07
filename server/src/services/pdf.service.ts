import PDFDocument from 'pdfkit';
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

// Helper: draw a horizontal line
function hline(doc: PDFKit.PDFDocument, y: number, x1: number, x2: number, color = C.borderLight, width = 0.5) {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke();
}

// Helper: draw a filled rect
function rect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, color: string) {
  doc.rect(x, y, w, h).fill(color);
}

/**
 * Generate a professional GST-compliant invoice PDF
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 45, right: 45 },
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

      const L = 45;  // left margin
      const R = 550; // right edge
      const W = R - L; // usable width

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // HEADER — "TAX INVOICE" title + Business name
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      // Top accent line
      rect(doc, 0, 0, 612, 4, C.primary);

      let y = 25;

      // Tax Invoice label (top right)
      doc.fontSize(10).font('Helvetica').fillColor(C.primary)
        .text('TAX INVOICE', R - 100, y, { width: 100, align: 'right' });

      // Business name
      doc.fontSize(18).font('Helvetica-Bold').fillColor(C.dark)
        .text(data.businessName, L, y);

      y += 26;

      // Business details line
      const bizDetails: string[] = [];
      if (data.businessAddress) bizDetails.push(data.businessAddress);
      if (bizDetails.length > 0) {
        doc.fontSize(8.5).font('Helvetica').fillColor(C.secondary)
          .text(bizDetails.join(' | '), L, y, { width: W });
        y += 13;
      }

      const bizMeta: string[] = [];
      if (data.businessGstin) bizMeta.push(`GSTIN: ${data.businessGstin}`);
      bizMeta.push(`Phone: ${data.businessPhone}`);
      if (data.businessUpiId) bizMeta.push(`UPI: ${data.businessUpiId}`);

      doc.fontSize(8).font('Helvetica').fillColor(C.light)
        .text(bizMeta.join('  |  '), L, y, { width: W });

      y += 20;
      hline(doc, y, L, R, C.border, 0.75);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // INVOICE META — Invoice #, Date, Due Date (right column)
      // BILL TO — Client info (left column)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      y += 15;
      const metaStartY = y;

      // --- Left: Bill To ---
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.light)
        .text('BILL TO', L, y);
      y += 13;
      doc.fontSize(13).font('Helvetica-Bold').fillColor(C.dark)
        .text(data.clientName, L, y);
      y += 18;
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

      // --- Right: Invoice details box ---
      const boxX = 360;
      const boxW = R - boxX;
      const boxH = 75;
      rect(doc, boxX, metaStartY - 5, boxW, boxH, C.headerBg);
      doc.rect(boxX, metaStartY - 5, boxW, boxH).strokeColor(C.borderLight).lineWidth(0.5).stroke();

      const labelX = boxX + 12;
      const valueX = boxX + 85;
      let ry = metaStartY + 5;

      const metaRows = [
        ['Invoice #', data.invoiceNo],
        ['Date', formatDateNumeric(data.createdAt)],
        ['Due Date', formatDateNumeric(data.dueDate)],
      ];
      metaRows.forEach(([label, value]) => {
        doc.fontSize(8).font('Helvetica').fillColor(C.secondary)
          .text(`${label}:`, labelX, ry);
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(C.dark)
          .text(value, valueX, ry);
        ry += 16;
      });

      // Status badge
      ry += 2;
      rect(doc, labelX, ry - 2, 55, 14, '#fef3c7');
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#92400e')
        .text('PENDING', labelX + 6, ry);

      y = Math.max(y, metaStartY + boxH + 10);
      y += 10;

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // LINE ITEMS TABLE
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      // Column positions
      const colSr    = L;
      const colItem  = L + 35;
      const colQty   = L + 290;
      const colRate  = L + 355;
      const colAmt   = L + 430;
      const rowH     = 26;

      // Table header
      rect(doc, L, y, W, rowH, C.primary);
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(C.white);
      doc.text('#', colSr + 10, y + 8, { width: 25 });
      doc.text('DESCRIPTION', colItem, y + 8, { width: 240 });
      doc.text('QTY', colQty, y + 8, { width: 55, align: 'center' });
      doc.text('RATE (Rs.)', colRate, y + 8, { width: 70, align: 'right' });
      doc.text('AMOUNT (Rs.)', colAmt, y + 8, { width: 75, align: 'right' });
      y += rowH;

      // Table rows
      data.lineItems.forEach((item, i) => {
        const bg = i % 2 === 0 ? C.white : C.rowAlt;
        rect(doc, L, y, W, rowH, bg);

        doc.fontSize(8.5).font('Helvetica').fillColor(C.text);
        doc.text(`${i + 1}`, colSr + 10, y + 8, { width: 25 });
        doc.text(item.name, colItem, y + 8, { width: 240 });
        doc.text(`${item.quantity}`, colQty, y + 8, { width: 55, align: 'center' });
        doc.text(fmt(item.rate), colRate, y + 8, { width: 70, align: 'right' });
        doc.font('Helvetica-Bold').fillColor(C.dark)
          .text(fmt(item.amount), colAmt, y + 8, { width: 75, align: 'right' });

        y += rowH;
      });

      // Bottom border of table
      hline(doc, y, L, R, C.border, 0.75);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TOTALS (right-aligned)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      y += 12;
      const tLabelX = colRate - 30;
      const tValueX = colAmt;
      const tValueW = 75;

      // Subtotal
      doc.fontSize(8.5).font('Helvetica').fillColor(C.secondary)
        .text('Subtotal', tLabelX, y, { width: 100, align: 'right' });
      doc.font('Helvetica').fillColor(C.dark)
        .text(`Rs. ${fmt(data.subtotal)}`, tValueX, y, { width: tValueW, align: 'right' });

      // GST
      if (data.gstRate > 0) {
        y += 16;
        const cgst = data.gstAmount / 2;
        doc.fontSize(8.5).font('Helvetica').fillColor(C.secondary)
          .text(`CGST (${data.gstRate / 2}%)`, tLabelX, y, { width: 100, align: 'right' });
        doc.fillColor(C.dark)
          .text(`Rs. ${fmt(cgst)}`, tValueX, y, { width: tValueW, align: 'right' });

        y += 16;
        doc.fillColor(C.secondary)
          .text(`SGST (${data.gstRate / 2}%)`, tLabelX, y, { width: 100, align: 'right' });
        doc.fillColor(C.dark)
          .text(`Rs. ${fmt(cgst)}`, tValueX, y, { width: tValueW, align: 'right' });
      }

      // Divider before total
      y += 14;
      hline(doc, y, tLabelX, R, C.border, 0.5);

      // Grand Total
      y += 8;
      rect(doc, tLabelX - 5, y - 3, (R - tLabelX + 5), 24, C.accent);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(C.primaryDark)
        .text('TOTAL', tLabelX, y + 2, { width: 100, align: 'right' });
      doc.fontSize(11).font('Helvetica-Bold').fillColor(C.primaryDark)
        .text(`Rs. ${fmt(data.totalAmount)}`, tValueX, y + 1, { width: tValueW, align: 'right' });

      // Amount in words
      y += 30;
      doc.fontSize(8).font('Helvetica-Oblique').fillColor(C.secondary)
        .text(`Amount: Rupees ${numberToWords(data.totalAmount)} Only`, L, y, { width: W });

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // PAYMENT SECTION — QR code + Bank details
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      y += 25;
      hline(doc, y, L, R, C.borderLight, 0.5);
      y += 12;

      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.primary)
        .text('PAYMENT INFORMATION', L, y);
      y += 16;

      let paymentSectionY = y;
      let qrRendered = false;

      // QR Code (left side)
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

            // QR box
            rect(doc, L, y - 5, 115, 125, C.headerBg);
            doc.rect(L, y - 5, 115, 125).strokeColor(C.borderLight).lineWidth(0.5).stroke();

            doc.image(qrBuffer, L + 7, y, { width: 100, height: 100 });
            doc.fontSize(7).font('Helvetica-Bold').fillColor(C.primary)
              .text('Scan to Pay', L, y + 103, { width: 115, align: 'center' });
            qrRendered = true;
          }
        } catch {
          logger.warn('QR code failed', { invoiceNo: data.invoiceNo });
        }
      }

      // Bank/UPI details (right side of QR or left if no QR)
      const detailX = qrRendered ? L + 130 : L;
      let dy = paymentSectionY;

      if (data.businessUpiId) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
          .text('UPI ID:', detailX, dy);
        doc.font('Helvetica').fillColor(C.dark)
          .text(data.businessUpiId, detailX + 80, dy);
        dy += 14;
      }

      if (data.bankAccountNo && data.bankIfsc) {
        if (data.bankAccountName) {
          doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
            .text('Account Name:', detailX, dy);
          doc.font('Helvetica').fillColor(C.dark)
            .text(data.bankAccountName, detailX + 80, dy);
          dy += 14;
        }
        doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
          .text('Account No:', detailX, dy);
        doc.font('Helvetica').fillColor(C.dark)
          .text(data.bankAccountNo, detailX + 80, dy);
        dy += 14;

        doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
          .text('IFSC:', detailX, dy);
        doc.font('Helvetica').fillColor(C.dark)
          .text(data.bankIfsc, detailX + 80, dy);
        dy += 14;

        if (data.bankName) {
          doc.fontSize(8).font('Helvetica-Bold').fillColor(C.text)
            .text('Bank:', detailX, dy);
          doc.font('Helvetica').fillColor(C.dark)
            .text(data.bankName, detailX + 80, dy);
          dy += 14;
        }
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // NOTES
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      y = Math.max(dy, paymentSectionY + (qrRendered ? 130 : 0)) + 15;
      if (data.notes) {
        hline(doc, y, L, R, C.borderLight, 0.5);
        y += 10;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(C.secondary)
          .text('Notes:', L, y);
        y += 12;
        doc.fontSize(8).font('Helvetica').fillColor(C.text)
          .text(data.notes, L, y, { width: W });
      }

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // TERMS & CONDITIONS
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      const termsY = doc.page.height - 90;
      hline(doc, termsY, L, R, C.borderLight, 0.5);

      doc.fontSize(7).font('Helvetica-Bold').fillColor(C.light)
        .text('Terms & Conditions', L, termsY + 6);
      doc.fontSize(6.5).font('Helvetica').fillColor(C.light)
        .text('1. Payment is due by the date mentioned above.', L, termsY + 17)
        .text('2. Please include the invoice number in your payment reference.', L, termsY + 27)
        .text('3. This is a computer-generated invoice.', L, termsY + 37);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // FOOTER
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      const footerY = doc.page.height - 30;
      rect(doc, 0, footerY - 5, 612, 35, C.headerBg);
      doc.fontSize(6.5).font('Helvetica').fillColor(C.light)
        .text('Generated by BillKaro — WhatsApp-First Smart Invoicing for Indian SMEs', L, footerY + 2, {
          width: W,
          align: 'center',
        });

      doc.end();
      logger.info('Professional PDF generated', { invoiceNo: data.invoiceNo });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Convert number to Indian English words (simplified)
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
  if (paise > 0) {
    result += ` and ${convert(paise)} Paise`;
  }
  return result;
}

/**
 * Save PDF — uploads to R2 in production, local filesystem in dev
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

/**
 * Legacy local save — kept for backward compatibility
 */
export async function savePDFLocally(invoiceNo: string, pdfBuffer: Buffer): Promise<string> {
  return savePDF(invoiceNo, pdfBuffer);
}
