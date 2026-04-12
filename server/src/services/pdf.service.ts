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
const M = 50;                  // margin (tighter than 60)
const PW = 595.28;             // A4 width
const PH = 841.89;             // A4 height
const CW = PW - M * 2;        // content width = 495.28
const LX = M;                  // left x
const RX = PW - M;            // right x
const PAGE_BOTTOM = PH - 50;  // safe bottom

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
 * Compact layout — 1-5 items fit on single page comfortably
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: M });
  const chunks: Uint8Array[] = [];

  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Uint8Array) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  let y = 25;
  let pageNumber = 1;

  // ── Page overflow helper ──────────────────────────────────
  function ensureSpace(needed: number): void {
    if (y + needed > PAGE_BOTTOM) {
      // Add page number to bottom-right of current page before breaking
      doc.fontSize(5).font('Helvetica').fillColor(lightGray)
        .text(`Page ${pageNumber}`, RX - 40, PAGE_BOTTOM + 8);
      doc.addPage();
      pageNumber++;
      y = 35;
      addPageHeader(doc, data.invoiceNo, pageNumber);
      y += 8;
    }
  }

  // ══════════════════════════════════════════════════════════
  // TOP ACCENT BAR
  // ══════════════════════════════════════════════════════════
  doc.rect(0, 0, PW, 4).fill(blue);

  // ══════════════════════════════════════════════════════════
  // STATUS WATERMARK (diagonal stamp for PAID / OVERDUE)
  // ══════════════════════════════════════════════════════════
  if (data.status === 'PAID' || data.status === 'OVERDUE' || data.status === 'CANCELLED') {
    doc.save();
    const stampColor = data.status === 'PAID'
      ? '#16a34a'
      : data.status === 'OVERDUE'
        ? '#dc2626'
        : '#6b7280';
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
  // HEADER ROW: Business Name (left) + INVOICE (right)
  // ══════════════════════════════════════════════════════════
  doc.fontSize(16).font('Helvetica-Bold').fillColor(dark)
    .text(data.businessName, LX, y, { width: CW * 0.6 });

  doc.fontSize(20).font('Helvetica-Bold').fillColor(blue)
    .text('INVOICE', LX, y, { width: CW, align: 'right' });

  y += 22;

  // Business address + details (single compact line)
  if (data.businessAddress) {
    doc.fontSize(7.5).font('Helvetica').fillColor(gray)
      .text(data.businessAddress, LX, y, { width: CW * 0.65 });
    y += 10;
  }

  // Business meta: GSTIN | Phone | UPI
  const details: string[] = [];
  if (data.businessGstin) details.push(`GSTIN: ${data.businessGstin}`);
  details.push(`Ph: ${data.businessPhone}`);
  if (data.businessUpiId) details.push(`UPI: ${data.businessUpiId}`);
  doc.fontSize(6.5).font('Helvetica').fillColor(lightGray)
    .text(details.join('  |  '), LX, y);

  // Invoice number + status badge (right side)
  doc.fontSize(9).font('Helvetica-Bold').fillColor(dark)
    .text(`# ${data.invoiceNo}`, LX, y - 1, { width: CW, align: 'right' });

  if (data.status && data.status !== 'PENDING') {
    const badgeColors: Record<string, { bg: string; fg: string }> = {
      PAID: { bg: '#dcfce7', fg: '#166534' },
      OVERDUE: { bg: '#fee2e2', fg: '#dc2626' },
      PARTIALLY_PAID: { bg: '#fef3c7', fg: '#92400e' },
      CANCELLED: { bg: '#f3f4f6', fg: '#6b7280' },
    };
    const badge = badgeColors[data.status] || badgeColors.PAID;
    const badgeText = data.status.replace('_', ' ');
    const badgeW = doc.fontSize(5.5).font('Helvetica-Bold').widthOfString(badgeText) + 10;
    const badgeX = RX - badgeW;
    const badgeY = y + 11;
    doc.roundedRect(badgeX, badgeY, badgeW, 12, 6).fill(badge.bg);
    doc.fontSize(5.5).font('Helvetica-Bold').fillColor(badge.fg)
      .text(badgeText, badgeX, badgeY + 2.5, { width: badgeW, align: 'center' });
  }

  y += 16;

  // Divider
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.75).stroke();

  // ══════════════════════════════════════════════════════════
  // BILL TO (left) + DATES (right) — compact 2-column layout
  // ══════════════════════════════════════════════════════════
  y += 10;
  const billToStartY = y;

  // Left side: Bill To
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor(lightGray).text('BILL TO', LX, y);
  y += 10;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(dark).text(data.clientName, LX, y);
  y += 14;
  if (data.clientPhone) {
    doc.fontSize(7.5).font('Helvetica').fillColor(gray).text(`Ph: ${data.clientPhone}`, LX, y);
    y += 10;
  }
  if (data.clientGstin) {
    doc.fontSize(7.5).font('Helvetica').fillColor(gray).text(`GSTIN: ${data.clientGstin}`, LX, y);
    y += 10;
  }

  // Right side: Dates (vertically aligned at top-right)
  const dateBlockY = billToStartY + 10;
  doc.fontSize(7.5).font('Helvetica').fillColor(gray)
    .text(`Date:  ${formatDateIST(data.createdAt)}`, LX, dateBlockY, { width: CW, align: 'right' });
  doc.text(`Due:   ${formatDateIST(data.dueDate)}`, LX, dateBlockY + 12, { width: CW, align: 'right' });

  y += 6;

  // ══════════════════════════════════════════════════════════
  // LINE ITEMS TABLE
  // ══════════════════════════════════════════════════════════

  // 5-column layout: # | Description | Qty | Unit Cost | Total
  const snX   = LX;
  const snW   = 28;
  const descX = LX + snW;
  const descW = CW - snW - 50 - 80 - 90; // remaining after other cols
  const qtyX  = descX + descW;
  const qtyW  = 50;
  const rateX = qtyX + qtyW;
  const rateW = 80;
  const totX  = rateX + rateW;
  const totW  = RX - totX;

  ensureSpace(28);

  // Table header
  const hdrH = 24;
  doc.rect(LX, y, CW, hdrH).fill('#374151');
  doc.fontSize(7).font('Helvetica-Bold').fillColor(white);
  doc.text('#', snX + 4, y + 7, { width: snW - 4, align: 'center' });
  doc.text('DESCRIPTION', descX + 8, y + 7);
  doc.text('QTY', qtyX, y + 7, { width: qtyW, align: 'center' });
  doc.text('UNIT COST', rateX, y + 7, { width: rateW, align: 'right' });
  doc.text('TOTAL', totX, y + 7, { width: totW, align: 'right' });
  y += hdrH;

  // Data rows — compact dynamic height
  data.lineItems.forEach((item, i) => {
    const textHeight = doc.fontSize(8.5).font('Helvetica')
      .heightOfString(item.name, { width: descW - 16 });
    const rowH = Math.max(24, textHeight + 12);

    ensureSpace(rowH);

    const textY = y + (rowH - textHeight) / 2;

    // Alternating bg
    if (i % 2 === 0) {
      doc.rect(LX, y, CW, rowH).fill(bgLight);
    }
    // Left accent bar
    doc.rect(LX, y, 2.5, rowH).fill(blue);

    // Content
    doc.fontSize(7.5).font('Helvetica').fillColor(lightGray)
      .text(`${i + 1}`, snX + 4, textY, { width: snW - 4, align: 'center' });

    doc.fontSize(8.5).font('Helvetica').fillColor(dark)
      .text(item.name, descX + 8, textY, { width: descW - 16 });

    doc.text(`${item.quantity}`, qtyX, textY, { width: qtyW, align: 'center' });
    doc.text(`Rs. ${fmt(item.rate)}`, rateX, textY, { width: rateW, align: 'right' });

    doc.font('Helvetica-Bold').fillColor(blue)
      .text(`Rs. ${fmt(item.amount)}`, totX, textY, { width: totW, align: 'right' });

    y += rowH;
  });

  // Table bottom border
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();

  // ══════════════════════════════════════════════════════════
  // SUBTOTALS + TOTAL DUE (compact right-aligned block)
  // ══════════════════════════════════════════════════════════
  y += 8;
  ensureSpace(70);

  const sLblX = rateX - 10;
  const sLblW = rateW + 10;
  const sValX = totX;
  const sValW = totW;

  // Subtotal
  doc.fontSize(8).font('Helvetica').fillColor(gray)
    .text('Subtotal:', sLblX, y, { width: sLblW, align: 'right' });
  doc.fillColor(dark)
    .text(`Rs. ${fmt(data.subtotal)}`, sValX, y, { width: sValW, align: 'right' });

  // Taxes
  if (data.gstRate > 0) {
    const cgst = Math.floor(data.gstAmount * 100 / 2) / 100;
    const sgst = Math.round((data.gstAmount - cgst) * 100) / 100;
    y += 13;
    doc.fillColor(gray).text(`CGST (${data.gstRate / 2}%):`, sLblX, y, { width: sLblW, align: 'right' });
    doc.fillColor(dark).text(`Rs. ${fmt(cgst)}`, sValX, y, { width: sValW, align: 'right' });
    y += 13;
    doc.fillColor(gray).text(`SGST (${data.gstRate / 2}%):`, sLblX, y, { width: sLblW, align: 'right' });
    doc.fillColor(dark).text(`Rs. ${fmt(sgst)}`, sValX, y, { width: sValW, align: 'right' });
  }

  // Thin divider before total
  y += 10;
  doc.moveTo(sLblX, y).lineTo(RX, y).strokeColor(blue).lineWidth(1).stroke();
  y += 6;

  // TOTAL DUE — bold with blue box
  doc.fontSize(10).font('Helvetica-Bold').fillColor(dark)
    .text('TOTAL DUE:', sLblX, y, { width: sLblW, align: 'right' });

  const totalText = `Rs. ${fmt(data.totalAmount)}`;
  doc.roundedRect(sValX - 4, y - 3, sValW + 8, 20, 3)
    .strokeColor(blue).lineWidth(1.5).stroke();
  doc.fontSize(10).font('Helvetica-Bold').fillColor(blue)
    .text(totalText, sValX, y, { width: sValW, align: 'right' });

  // ══════════════════════════════════════════════════════════
  // AMOUNT IN WORDS (inline, compact)
  // ══════════════════════════════════════════════════════════
  y += 24;
  ensureSpace(18);

  const wordsText = `Rupees ${numberToWords(data.totalAmount)} Only`;
  doc.roundedRect(LX, y - 1, CW, 16, 2).fillAndStroke(bgLight, border);
  doc.fontSize(7).font('Helvetica-Bold').fillColor(gray)
    .text('In Words:', LX + 6, y + 3);
  doc.fontSize(7).font('Helvetica-Oblique').fillColor(dark)
    .text(wordsText, LX + 58, y + 3, { width: CW - 64 });

  // ══════════════════════════════════════════════════════════
  // PAYMENT INFORMATION (compact — QR + details side by side)
  // ══════════════════════════════════════════════════════════
  y += 22;
  ensureSpace(100);
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
  y += 8;
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(blue).text('PAYMENT INFORMATION', LX, y);
  y += 12;

  const payTop = y;
  let qrDone = false;

  // QR Code — smaller 80x80
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
        doc.rect(LX, y - 2, 80, 90).fillAndStroke(bgLight, border);
        doc.image(buf, LX + 4, y, { width: 72, height: 72 });
        doc.fontSize(5.5).font('Helvetica-Bold').fillColor(blue)
          .text('Scan to Pay', LX, y + 74, { width: 80, align: 'center' });
        qrDone = true;
      }
    } catch { /* skip */ }
  }

  // Payment details
  const px = qrDone ? LX + 90 : LX;
  const labelW = 70;
  const valueW = CW - (qrDone ? 90 : 0) - labelW;
  let py = payTop;

  const drawDetail = (label: string, value: string) => {
    doc.fontSize(7).font('Helvetica-Bold').fillColor(gray)
      .text(label, px, py, { width: labelW });
    doc.font('Helvetica').fillColor(dark)
      .text(value, px + labelW, py, { width: valueW });
    py += 11;
  };

  if (data.businessUpiId) drawDetail('UPI ID:', data.businessUpiId);
  if (data.bankAccountNo) {
    if (data.bankAccountName) drawDetail('A/C Name:', data.bankAccountName);
    drawDetail('A/C No:', data.bankAccountNo);
    if (data.bankIfsc) drawDetail('IFSC:', data.bankIfsc);
    if (data.bankName) drawDetail('Bank:', data.bankName);
  }

  y = Math.max(py, payTop + (qrDone ? 92 : 0)) + 4;

  // ══════════════════════════════════════════════════════════
  // NOTES (if any)
  // ══════════════════════════════════════════════════════════
  if (data.notes) {
    ensureSpace(30);
    doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
    y += 6;
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(gray).text('Notes:', LX, y);
    doc.fontSize(6.5).font('Helvetica').fillColor(dark)
      .text(data.notes, LX + 32, y, { width: CW - 32 });
    const notesH = doc.fontSize(6.5).font('Helvetica')
      .heightOfString(data.notes, { width: CW - 32 });
    y += Math.max(14, notesH + 6);
  }

  // ══════════════════════════════════════════════════════════
  // TERMS + THANK YOU (single compact section)
  // ══════════════════════════════════════════════════════════
  y += 4;
  ensureSpace(35);
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
  y += 5;

  // Thank you + Terms on same level
  doc.fontSize(7).font('Helvetica-Oblique').fillColor(gray)
    .text('Thank you for your business!', LX, y);

  y += 12;
  doc.fontSize(5.5).font('Helvetica').fillColor(lightGray)
    .text('Terms: 1. Payment due by date above.  2. Include invoice number in payment reference.  3. Computer-generated invoice — no signature required.', LX, y, { width: CW });

  // ══════════════════════════════════════════════════════════
  // FOOTER BAR (compact)
  // ══════════════════════════════════════════════════════════
  y += 16;
  ensureSpace(30);
  doc.moveTo(LX, y).lineTo(RX, y).strokeColor(border).lineWidth(0.5).stroke();
  y += 4;
  doc.rect(LX, y, CW, 24).fill(bgLight);

  const logo = getLogoPath();
  if (logo) {
    try {
      doc.image(logo, LX + 6, y + 1, { height: 22 });
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(blue)
        .text('Powered by BillKaro', LX + 95, y + 4);
      doc.fontSize(5).font('Helvetica').fillColor(lightGray)
        .text('WhatsApp-First Smart Invoicing for Indian SMEs', LX + 95, y + 13);
    } catch {
      renderFooterTextOnly(doc, y);
    }
  } else {
    renderFooterTextOnly(doc, y);
  }

  // Page number — render inside the footer bar (right-aligned) to avoid overflow
  if (pageNumber > 1) {
    doc.fontSize(5).font('Helvetica').fillColor(lightGray)
      .text(`Page ${pageNumber}`, LX, y + 9, { width: CW - 8, align: 'right' });
  }

  doc.end();
  logger.info('PDF generated', { invoiceNo: data.invoiceNo, pages: pageNumber });

  return bufferPromise;
}

// ── Helpers ────────────────────────────────────────────────
function renderFooterTextOnly(doc: typeof PDFDocument.prototype, y: number): void {
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor(blue)
    .text('Powered by BillKaro', LX + 8, y + 5);
  doc.fontSize(5).font('Helvetica').fillColor(lightGray)
    .text('WhatsApp-First Smart Invoicing for Indian SMEs', LX + 8, y + 14);
}

// Page footer is now rendered inline within the footer bar
// to avoid PDFKit auto-creating new pages when text is placed near PH boundary

function addPageHeader(doc: typeof PDFDocument.prototype, invoiceNo: string, pageNum: number): void {
  doc.rect(0, 0, PW, 3).fill(blue);
  doc.fontSize(7.5).font('Helvetica').fillColor(gray)
    .text(`Invoice ${invoiceNo} — continued`, LX, 18);
  doc.fontSize(7.5).font('Helvetica').fillColor(lightGray)
    .text(`Page ${pageNum}`, LX, 18, { width: CW, align: 'right' });
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
