import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { formatNumber } from '../utils/currency';
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
  status?: 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
}

// ── Constants ──────────────────────────────────────────────
const M = 60;                  // margin
const PW = 595.28;             // A4 width
const PH = 841.89;             // A4 height
const CW = PW - M * 2;        // content width = 475.28
const LX = M;                  // left x
const RX = PW - M;            // right x
const PAGE_BOTTOM = PH - 60;  // safe bottom (60pt margin)

// ── Colors ─────────────────────────────────────────────────
const blue = '#2563eb';
const dark = '#1f2937';
const gray = '#6b7280';
const lightGray = '#9ca3af';
const border = '#e5e7eb';
const bgLight = '#f9fafb';
const white = '#ffffff';

function fmt(n: number): string { return formatNumber(n); }

/**
 * Format date as DD/MM/YYYY in IST timezone
 */
function formatDateIST(date: Date): string {
  const istDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  const d = istDate.getUTCDate().toString().padStart(2, '0');
  const m = (istDate.getUTCMonth() + 1).toString().padStart(2, '0');
  const y = istDate.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

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
 * Uses PDFKit — no browser/Puppeteer dependency
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: M });
  const chunks: Uint8Array[] = [];

  // Collect buffer chunks
  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Uint8Array) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let y = 30;
  let pageNumber = 1;

  // ── Page overflow helper ──────────────────────────────────
  // Checks if we have enough room; if not, adds a new page
  function ensureSpace(needed: number): void {
    if (y + needed > PAGE_BOTTOM) {
      addPageFooter(doc, pageNumber);
      doc.addPage();
      pageNumber++;
      y = 40;
      addPageHeader(doc, data.invoiceNo, pageNumber);
      y += 10;
    }
  }

  // ══════════════════════════════════════════════════════════
  // TOP BAR
  // ══════════════════════════════════════════════════════════
  doc.rect(0, 0, PW, 5).fill(blue);

  // ══════════════════════════════════════════════════════════
  // STATUS WATERMARK (diagonal stamp for PAID / OVERDUE)
  // ══════════════════════════════════════════════════════════
  if (data.status === 'PAID' || data.status === 'OVERDUE' || data.status === 'CANCELLED') {
    doc.save();
    const stampColor = data.status === 'PAID'
      ? '#16a34a' // green
      : data.status === 'OVERDUE'
        ? '#dc2626' // red
        : '#6b7280'; // gray for cancelled
    const stampText = data.status === 'PAID'
      ? 'PAID'
      : data.status === 'OVERDUE'
        ? 'OVERDUE'
        : 'CANCELLED';

    doc.translate(PW / 2, PH / 2);
    doc.rotate(-35);
    doc.fontSize(72).font('Helvetica-Bold')
      .fillColor(stampColor).opacity(0.08)
      .text(stampText, -180, -30, { width: 360, align: 'center' });
    doc.opacity(1);
    doc.restore();
  }

  // ══════════════════════════════════════════════════════════
  // HEADER: Business Name (left) + INVOICE label (right)
  // ══════════════════════════════════════════════════════════
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
    .text(details.join('  |  '), LX, y);

  // Invoice # and status badge (right aligned, below INVOICE)
  const statusY = y - 5;
  doc.fontSize(10).font('Helvetica-Bold').fillColor(dark)
    .text(`# ${data.invoiceNo}`, LX, statusY, { width: CW, align: 'right' });

  // Status badge next to invoice number
  if (data.status && data.status !== 'PENDING') {
    const badgeColors: Record<string, { bg: string; fg: string }> = {
      PAID: { bg: '#dcfce7', fg: '#166534' },
      OVERDUE: { bg: '#fee2e2', fg: '#dc2626' },
      PARTIALLY_PAID: { bg: '#fef3c7', fg: '#92400e' },
      CANCELLED: { bg: '#f3f4f6', fg: '#6b7280' },
    };
    const badge = badgeColors[data.status] || badgeColors.PAID;
    const badgeText = data.status.replace('_', ' ');
    const badgeW = doc.fontSize(6).font('Helvetica-Bold').widthOfString(badgeText) + 12;
    const badgeX = RX - badgeW;
    const badgeY = statusY + 14;
    doc.roundedRect(badgeX, badgeY, badgeW, 14, 7).fill(badge.bg);
    doc.fontSize(6).font('Helvetica-Bold').fillColor(badge.fg)
      .text(badgeText, badgeX, badgeY + 3, { width: badgeW, align: 'center' });
  }

  y += 22;

  // Divider
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.75).stroke();

  // ══════════════════════════════════════════════════════════
  // BILL TO (left) + DATES (right)
  // ══════════════════════════════════════════════════════════
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
    .text(`Date: ${formatDateIST(data.createdAt)}`, LX, dateY, { width: CW, align: 'right' });
  doc.text(`Due: ${formatDateIST(data.dueDate)}`, LX, dateY + 14, { width: CW, align: 'right' });

  y += 12;

  // ══════════════════════════════════════════════════════════
  // LINE ITEMS TABLE (with serial number column)
  // ══════════════════════════════════════════════════════════

  // 5-column layout: S.No | Description | Qty | Unit Cost | Total
  const snX   = LX;
  const snW   = 30;
  const descX = LX + snW;
  const descW = 205;
  const qtyX  = descX + descW;
  const qtyW  = 50;
  const rateX = qtyX + qtyW;
  const rateW = 85;
  const totX  = rateX + rateW;
  const totW  = RX - totX;

  ensureSpace(30);

  // Table header row
  const hdrH = 28;
  doc.rect(LX, y, CW, hdrH).fill('#374151');
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(white);
  doc.text('#', snX + 6, y + 9, { width: snW - 6, align: 'center' });
  doc.text('DESCRIPTION', descX + 8, y + 9);
  doc.text('QTY', qtyX, y + 9, { width: qtyW, align: 'center' });
  doc.text('UNIT COST', rateX, y + 9, { width: rateW, align: 'right' });
  doc.text('TOTAL', totX, y + 9, { width: totW, align: 'right' });
  y += hdrH;

  // Data rows with dynamic height
  data.lineItems.forEach((item, i) => {
    // Measure actual text height for description
    const textHeight = doc.fontSize(9).font('Helvetica')
      .heightOfString(item.name, { width: descW - 16 });
    const rowH = Math.max(30, textHeight + 18); // min 30pt, pad for centering

    ensureSpace(rowH);

    const textY = y + (rowH - textHeight) / 2;

    // Alternating background
    if (i % 2 === 0) {
      doc.rect(LX, y, CW, rowH).fill(bgLight);
    }
    // Left accent bar
    doc.rect(LX, y, 3, rowH).fill(blue);

    // Serial number
    doc.fontSize(8).font('Helvetica').fillColor(lightGray)
      .text(`${i + 1}`, snX + 6, textY, { width: snW - 6, align: 'center' });

    // Description (dynamic height)
    doc.fontSize(9).font('Helvetica').fillColor(dark)
      .text(item.name, descX + 8, textY, { width: descW - 16 });

    // Qty
    doc.text(`${item.quantity}`, qtyX, textY, { width: qtyW, align: 'center' });

    // Unit cost
    doc.text(`Rs. ${fmt(item.rate)}`, rateX, textY, { width: rateW, align: 'right' });

    // Total
    doc.font('Helvetica-Bold').fillColor(blue)
      .text(`Rs. ${fmt(item.amount)}`, totX, textY, { width: totW, align: 'right' });

    y += rowH;
  });

  // Bottom border of table
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();

  // ══════════════════════════════════════════════════════════
  // SUBTOTALS (right-aligned)
  // ══════════════════════════════════════════════════════════
  y += 12;

  const sLblX = rateX;
  const sLblW = rateW;
  const sValX = totX;
  const sValW = totW;

  ensureSpace(80);

  // Subtotal
  doc.fontSize(8.5).font('Helvetica').fillColor(gray)
    .text('Subtotal:', sLblX, y, { width: sLblW, align: 'right' });
  doc.fillColor(dark)
    .text(`Rs. ${fmt(data.subtotal)}`, sValX, y, { width: sValW, align: 'right' });

  // Taxes — Fixed rounding: CGST gets floor, SGST gets remainder
  if (data.gstRate > 0) {
    const cgst = Math.floor(data.gstAmount * 100 / 2) / 100;
    const sgst = Math.round((data.gstAmount - cgst) * 100) / 100;
    y += 16;
    doc.fillColor(gray).text(`CGST (${data.gstRate / 2}%):`, sLblX, y, { width: sLblW, align: 'right' });
    doc.fillColor(dark).text(`Rs. ${fmt(cgst)}`, sValX, y, { width: sValW, align: 'right' });
    y += 16;
    doc.fillColor(gray).text(`SGST (${data.gstRate / 2}%):`, sLblX, y, { width: sLblW, align: 'right' });
    doc.fillColor(dark).text(`Rs. ${fmt(sgst)}`, sValX, y, { width: sValW, align: 'right' });
  }

  // ══════════════════════════════════════════════════════════
  // TOTAL DUE BOX (below subtotals, right-aligned)
  // ══════════════════════════════════════════════════════════
  y += 24;
  ensureSpace(50);

  doc.fontSize(11).font('Helvetica-Bold').fillColor(dark)
    .text('TOTAL DUE:', sLblX - 40, y, { width: sLblW + 40, align: 'right' });

  // Total amount in a rounded box
  const totalText = `Rs. ${fmt(data.totalAmount)}`;
  doc.roundedRect(sValX - 5, y - 4, sValW + 10, 22, 4)
    .strokeColor(blue).lineWidth(1.5).stroke();
  doc.fontSize(11).font('Helvetica-Bold').fillColor(blue)
    .text(totalText, sValX, y, { width: sValW, align: 'right' });

  // ══════════════════════════════════════════════════════════
  // AMOUNT IN WORDS (prominent, bordered)
  // ══════════════════════════════════════════════════════════
  y += 30;
  ensureSpace(30);

  const wordsText = `Rupees ${numberToWords(data.totalAmount)} Only`;
  doc.roundedRect(LX, y - 2, CW, 20, 3).fillAndStroke(bgLight, border);
  doc.fontSize(8).font('Helvetica-Bold').fillColor(gray)
    .text('Amount in Words:', LX + 8, y + 3);
  doc.fontSize(8).font('Helvetica-Oblique').fillColor(dark)
    .text(wordsText, LX + 110, y + 3, { width: CW - 118 });

  // ══════════════════════════════════════════════════════════
  // THANK YOU MESSAGE (separate line, below totals)
  // ══════════════════════════════════════════════════════════
  y += 26;
  doc.fontSize(8).font('Helvetica-Oblique').fillColor(gray)
    .text('Thank you for your business!', LX, y);

  // ══════════════════════════════════════════════════════════
  // PAYMENT INFORMATION
  // ══════════════════════════════════════════════════════════
  y += 18;
  ensureSpace(120);
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
    } catch { /* skip QR if it fails */ }
  }

  // Payment details (proportional label/value widths)
  const px = qrDone ? LX + 108 : LX;
  const labelW = 80;
  const valueW = CW - (qrDone ? 108 : 0) - labelW;
  let py = payTop;

  const drawDetail = (label: string, value: string) => {
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(gray)
      .text(label, px, py, { width: labelW });
    doc.font('Helvetica').fillColor(dark)
      .text(value, px + labelW, py, { width: valueW });
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

  // ══════════════════════════════════════════════════════════
  // NOTES
  // ══════════════════════════════════════════════════════════
  if (data.notes) {
    ensureSpace(40);
    doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
    y += 8;
    doc.fontSize(7).font('Helvetica-Bold').fillColor(gray).text('Notes:', LX, y);
    doc.fontSize(7).font('Helvetica').fillColor(dark)
      .text(data.notes, LX + 35, y, { width: CW - 35 });
    // Measure actual height of notes text
    const notesH = doc.fontSize(7).font('Helvetica')
      .heightOfString(data.notes, { width: CW - 35 });
    y += Math.max(18, notesH + 8);
  }

  // ══════════════════════════════════════════════════════════
  // TERMS & CONDITIONS
  // ══════════════════════════════════════════════════════════
  y += 5;
  ensureSpace(40);
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
  y += 6;
  doc.fontSize(6).font('Helvetica-Bold').fillColor(lightGray).text('Terms & Conditions', LX, y);
  y += 9;
  doc.fontSize(5.5).font('Helvetica').fillColor(lightGray)
    .text('1. Payment is due by the date mentioned above.  2. Please include the invoice number in your payment reference.  3. This is a computer-generated invoice.', LX, y, { width: CW });

  // ══════════════════════════════════════════════════════════
  // FOOTER WITH LOGO + PAGE NUMBER
  // ══════════════════════════════════════════════════════════
  y += 20;
  ensureSpace(45);
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
  y += 6;
  doc.rect(LX, y, CW, 32).fill(bgLight);

  const logo = getLogoPath();
  if (logo) {
    try {
      doc.image(logo, LX + 8, y + 2, { height: 28 });
      // Dynamically position text after logo
      const logoTextX = LX + 115;
      doc.fontSize(7).font('Helvetica-Bold').fillColor(blue)
        .text('Powered by BillKaro', logoTextX, y + 5);
      doc.fontSize(5.5).font('Helvetica').fillColor(lightGray)
        .text('WhatsApp-First Smart Invoicing for Indian SMEs', logoTextX, y + 16);
    } catch {
      renderFooterTextOnly(doc, y);
    }
  } else {
    renderFooterTextOnly(doc, y);
  }

  // Page number on the final page
  addPageFooter(doc, pageNumber);

  doc.end();
  logger.info('PDF generated', { invoiceNo: data.invoiceNo, pages: pageNumber });

  return bufferPromise;
}

// ── Helper: Footer text when logo is unavailable ────────────
function renderFooterTextOnly(doc: typeof PDFDocument.prototype, y: number): void {
  doc.fontSize(7).font('Helvetica-Bold').fillColor(blue)
    .text('Powered by BillKaro', LX + 10, y + 7);
  doc.fontSize(5.5).font('Helvetica').fillColor(lightGray)
    .text('WhatsApp-First Smart Invoicing for Indian SMEs', LX + 10, y + 18);
}

// ── Helper: Page footer (page number) ───────────────────────
function addPageFooter(doc: typeof PDFDocument.prototype, pageNum: number): void {
  doc.fontSize(6).font('Helvetica').fillColor(lightGray)
    .text(`Page ${pageNum}`, LX, PH - 30, { width: CW, align: 'center' });
}

// ── Helper: Continuation header for page 2+ ─────────────────
function addPageHeader(doc: typeof PDFDocument.prototype, invoiceNo: string, pageNum: number): void {
  doc.rect(0, 0, PW, 3).fill(blue);
  doc.fontSize(8).font('Helvetica').fillColor(gray)
    .text(`Invoice ${invoiceNo} — continued`, LX, 20);
  doc.fontSize(8).font('Helvetica').fillColor(lightGray)
    .text(`Page ${pageNum}`, LX, 20, { width: CW, align: 'right' });
}

// ══════════════════════════════════════════════════════════
// NUMBER TO WORDS (Indian number system: Lakh, Crore)
// ══════════════════════════════════════════════════════════
function numberToWords(num: number): string {
  if (num === 0) return 'Zero';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const whole = Math.floor(num);
  // Fixed: use multiplication-based extraction to avoid floating point drift
  const paise = Math.round(num * 100) % 100;

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

// ══════════════════════════════════════════════════════════
// SAVE PDF (R2 or local)
// ══════════════════════════════════════════════════════════
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
