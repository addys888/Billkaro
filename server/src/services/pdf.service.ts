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

// Color palette
const COLORS = {
  primary: '#1a56db',
  primaryLight: '#e8effc',
  dark: '#111827',
  secondary: '#6b7280',
  border: '#e5e7eb',
  white: '#ffffff',
  success: '#059669',
  bg: '#f9fafb',
};

function formatCurrencyPDF(amount: number): string {
  return `₹${formatNumber(amount)}`;
}

/**
 * Generate an invoice PDF using PDFKit (no Chrome/Puppeteer needed)
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Invoice ${data.invoiceNo}`,
          Author: data.businessName,
        },
      });

      const chunks: Uint8Array[] = [];
      doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 80; // 40px margin each side
      const leftMargin = 40;

      // ── Header ──────────────────────────────────────────
      // Blue header bar
      doc.rect(0, 0, doc.page.width, 90).fill(COLORS.primary);

      doc.fontSize(24).fillColor(COLORS.white).font('Helvetica-Bold')
        .text(data.businessName, leftMargin, 25, { width: pageWidth * 0.6 });

      doc.fontSize(10).fillColor(COLORS.white).font('Helvetica')
        .text(`INVOICE`, doc.page.width - 180, 25, { width: 140, align: 'right' })
        .fontSize(16).font('Helvetica-Bold')
        .text(data.invoiceNo, doc.page.width - 180, 40, { width: 140, align: 'right' });

      if (data.businessAddress) {
        doc.fontSize(9).font('Helvetica').fillColor(COLORS.white)
          .text(data.businessAddress, leftMargin, 55, { width: pageWidth * 0.6 });
      }

      // ── Business Details Row ────────────────────────────
      let y = 105;

      doc.fontSize(8).fillColor(COLORS.secondary).font('Helvetica');
      if (data.businessGstin) {
        doc.text(`GSTIN: ${data.businessGstin}`, leftMargin, y);
      }
      doc.text(`Phone: ${data.businessPhone}`, leftMargin + 200, y);
      if (data.businessUpiId) {
        doc.text(`UPI: ${data.businessUpiId}`, leftMargin + 380, y);
      }

      // ── Divider ─────────────────────────────────────────
      y = 125;
      doc.moveTo(leftMargin, y).lineTo(leftMargin + pageWidth, y).strokeColor(COLORS.border).lineWidth(1).stroke();

      // ── Bill To & Invoice Details ───────────────────────
      y = 140;

      // Bill To
      doc.fontSize(8).fillColor(COLORS.secondary).font('Helvetica-Bold')
        .text('BILL TO', leftMargin, y);
      doc.fontSize(12).fillColor(COLORS.dark).font('Helvetica-Bold')
        .text(data.clientName, leftMargin, y + 14);
      if (data.clientPhone) {
        doc.fontSize(9).font('Helvetica').fillColor(COLORS.secondary)
          .text(data.clientPhone, leftMargin, y + 30);
      }
      if (data.clientGstin) {
        doc.fontSize(9).font('Helvetica').fillColor(COLORS.secondary)
          .text(`GSTIN: ${data.clientGstin}`, leftMargin, y + 43);
      }

      // Invoice Details (right side)
      const rightCol = leftMargin + 350;
      doc.fontSize(8).fillColor(COLORS.secondary).font('Helvetica-Bold')
        .text('INVOICE DETAILS', rightCol, y);

      doc.fontSize(9).font('Helvetica').fillColor(COLORS.dark);
      const details = [
        ['Date:', formatDateNumeric(data.createdAt)],
        ['Due Date:', formatDateNumeric(data.dueDate)],
        ['Status:', 'PENDING'],
      ];
      details.forEach(([label, value], i) => {
        doc.font('Helvetica').fillColor(COLORS.secondary)
          .text(label, rightCol, y + 14 + i * 16, { continued: true })
          .font('Helvetica-Bold').fillColor(COLORS.dark)
          .text(`  ${value}`);
      });

      // ── Line Items Table ────────────────────────────────
      y = 210;

      // Table header
      doc.rect(leftMargin, y, pageWidth, 24).fill(COLORS.primaryLight);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.primary);
      doc.text('#', leftMargin + 8, y + 7, { width: 25 });
      doc.text('ITEM / DESCRIPTION', leftMargin + 35, y + 7, { width: 230 });
      doc.text('QTY', leftMargin + 280, y + 7, { width: 50, align: 'center' });
      doc.text('RATE', leftMargin + 340, y + 7, { width: 70, align: 'right' });
      doc.text('AMOUNT', leftMargin + 420, y + 7, { width: 80, align: 'right' });

      y += 24;

      // Table rows
      data.lineItems.forEach((item, i) => {
        const rowBg = i % 2 === 0 ? COLORS.white : COLORS.bg;
        doc.rect(leftMargin, y, pageWidth, 22).fill(rowBg);

        doc.fontSize(9).font('Helvetica').fillColor(COLORS.dark);
        doc.text(`${i + 1}`, leftMargin + 8, y + 6, { width: 25 });
        doc.text(item.name, leftMargin + 35, y + 6, { width: 230 });
        doc.text(`${item.quantity}`, leftMargin + 280, y + 6, { width: 50, align: 'center' });
        doc.text(formatCurrencyPDF(item.rate), leftMargin + 340, y + 6, { width: 70, align: 'right' });
        doc.font('Helvetica-Bold')
          .text(formatCurrencyPDF(item.amount), leftMargin + 420, y + 6, { width: 80, align: 'right' });

        y += 22;
      });

      // Table bottom border
      doc.moveTo(leftMargin, y).lineTo(leftMargin + pageWidth, y).strokeColor(COLORS.border).lineWidth(1).stroke();

      // ── Totals ──────────────────────────────────────────
      y += 15;
      const totalsX = leftMargin + 320;

      // Subtotal
      doc.fontSize(9).font('Helvetica').fillColor(COLORS.secondary)
        .text('Subtotal:', totalsX, y, { width: 100, align: 'right' });
      doc.font('Helvetica-Bold').fillColor(COLORS.dark)
        .text(formatCurrencyPDF(data.subtotal), totalsX + 105, y, { width: 80, align: 'right' });

      // GST
      if (data.gstRate > 0) {
        y += 18;
        doc.font('Helvetica').fillColor(COLORS.secondary)
          .text(`GST (${data.gstRate}%):`, totalsX, y, { width: 100, align: 'right' });
        doc.font('Helvetica-Bold').fillColor(COLORS.dark)
          .text(formatCurrencyPDF(data.gstAmount), totalsX + 105, y, { width: 80, align: 'right' });
      }

      // Total
      y += 24;
      doc.rect(totalsX - 5, y - 5, 195, 28).fill(COLORS.primary);
      doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.white)
        .text('TOTAL:', totalsX, y + 2, { width: 100, align: 'right' });
      doc.fontSize(13)
        .text(formatCurrencyPDF(data.totalAmount), totalsX + 105, y, { width: 80, align: 'right' });

      // ── QR Code ─────────────────────────────────────────
      y += 50;
      if (data.businessUpiId) {
        try {
          const qrDataUrl = await generateUPIQRCode({
            upiId: data.businessUpiId,
            payeeName: data.businessName,
            amount: data.totalAmount,
            transactionNote: `Invoice ${data.invoiceNo}`,
          });

          if (qrDataUrl) {
            doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.primary)
              .text('Scan to Pay', leftMargin, y);
            // Convert data URL to buffer
            const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
            const qrBuffer = Buffer.from(qrBase64, 'base64');
            doc.image(qrBuffer, leftMargin, y + 14, { width: 100, height: 100 });

            doc.fontSize(8).font('Helvetica').fillColor(COLORS.secondary)
              .text(`UPI: ${data.businessUpiId}`, leftMargin + 110, y + 40);
          }
        } catch (err) {
          logger.warn('QR code generation failed for PDF', { invoiceNo: data.invoiceNo });
        }
      }

      // ── Bank Details ────────────────────────────────────
      if (data.bankAccountNo && data.bankIfsc) {
        const bankY = data.businessUpiId ? y + 130 : y;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.primary)
          .text('Bank Transfer Details', leftMargin, bankY);
        doc.fontSize(8).font('Helvetica').fillColor(COLORS.dark);
        const bankDetails = [
          data.bankAccountName && `Account: ${data.bankAccountName}`,
          `A/C No: ${data.bankAccountNo}`,
          `IFSC: ${data.bankIfsc}`,
          data.bankName && `Bank: ${data.bankName}`,
        ].filter(Boolean);
        bankDetails.forEach((line, i) => {
          doc.text(line!, leftMargin, bankY + 14 + i * 13);
        });
      }

      // ── Notes ───────────────────────────────────────────
      if (data.notes) {
        const notesY = doc.y + 20;
        doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.primary)
          .text('Notes', leftMargin, notesY);
        doc.fontSize(8).font('Helvetica').fillColor(COLORS.secondary)
          .text(data.notes, leftMargin, notesY + 14, { width: pageWidth });
      }

      // ── Footer ──────────────────────────────────────────
      const footerY = doc.page.height - 50;
      doc.moveTo(leftMargin, footerY).lineTo(leftMargin + pageWidth, footerY)
        .strokeColor(COLORS.border).lineWidth(0.5).stroke();
      doc.fontSize(7).font('Helvetica').fillColor(COLORS.secondary)
        .text('Generated by BillKaro — WhatsApp-First Smart Invoicing', leftMargin, footerY + 8, {
          width: pageWidth,
          align: 'center',
        });

      doc.end();

      logger.info('PDF generated with PDFKit', { invoiceNo: data.invoiceNo });
    } catch (error) {
      reject(error);
    }
  });
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
