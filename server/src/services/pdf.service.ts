import puppeteer from 'puppeteer';
import Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { formatCurrency, formatNumber } from '../utils/currency';
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

// Register Handlebars helpers
Handlebars.registerHelper('formatCurrency', (amount: number) => formatCurrency(amount));
Handlebars.registerHelper('formatNumber', (num: number) => formatNumber(num));
Handlebars.registerHelper('formatDate', (date: Date) => formatDateNumeric(date));
Handlebars.registerHelper('inc', (value: number) => value + 1);

/**
 * Generate an invoice PDF and return the buffer
 */
export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  try {
    // Generate UPI  A QR code if UPI ID available
    let qrCodeDataUrl: string | undefined;
    if (data.businessUpiId) {
      qrCodeDataUrl = await generateUPIQRCode({
        upiId: data.businessUpiId,
        payeeName: data.businessName,
        amount: data.totalAmount,
        transactionNote: `Invoice ${data.invoiceNo}`,
      });
    }

    // Load and compile template
    const templatePath = path.join(__dirname, '..', 'templates', 'invoice.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const template = Handlebars.compile(templateSource);

    // Render HTML
    const html = template({
      ...data,
      qrCode: qrCodeDataUrl,
      hasGst: data.gstRate > 0,
      hasBankDetails: !!(data.bankAccountNo && data.bankIfsc),
      isInterState: false, // TODO: detect from GST state codes
    });

    // Generate PDF with Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    });

    await browser.close();

    logger.info('PDF generated', { invoiceNo: data.invoiceNo, size: pdfBuffer.length });
    return Buffer.from(pdfBuffer);
  } catch (error) {
    logger.error('PDF generation failed', { invoiceNo: data.invoiceNo, error });
    throw error;
  }
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
