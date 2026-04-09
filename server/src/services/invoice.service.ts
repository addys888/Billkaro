import { prisma } from '../db/prisma';
import { PrismaClient, InvoiceStatus } from '@prisma/client';
import { generateInvoiceNumber } from '../utils/invoice-number';
import { calculateDueDate } from '../utils/dates';
import { generateInvoicePDF, savePDFLocally } from './pdf.service';
import { generatePaymentInfo } from './payment.service';
import { generateUPILink } from '../utils/upi';
import { config } from '../config';
import { logger } from '../utils/logger';



interface CreateInvoiceParams {
  userId: string;
  clientName: string;
  clientPhone?: string;
  amount: number;
  items: Array<{ name: string; quantity: number; rate: number }>;
  notes?: string;
  dueDays?: number;
  gstRate?: number;
}

interface InvoiceResult {
  id: string;
  invoiceNo: string;
  totalAmount: number;
  pdfUrl: string;
  pdfBuffer?: Buffer;
  paymentLink: string;
  clientId: string;
}

/**
 * Create a complete invoice: DB record + PDF + payment link
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
  const { userId, clientName, clientPhone, amount, items, notes, dueDays, gstRate: customGstRate } = params;

  // Get user details
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  // Find or create client
  let client = await findOrCreateClient(userId, clientName, clientPhone);

  // Calculate amounts — use custom GST rate if provided, otherwise merchant's default
  const gstRate = customGstRate != null ? customGstRate : Number(user.defaultGstRate);
  const subtotal = amount;
  const gstAmount = Math.round((subtotal * gstRate) / 100 * 100) / 100;
  const totalAmount = subtotal + gstAmount;

  // Generate invoice number
  const invoiceNo = await generateInvoiceNumber(userId, user.businessName);

  // Calculate due date
  const paymentTerms = dueDays || user.defaultPaymentTermsDays;
  const dueDate = calculateDueDate(new Date(), paymentTerms);

  // Prepare line items with amounts
  const lineItems = items.map((item) => ({
    ...item,
    amount: item.quantity * item.rate,
  }));

  // Create invoice record
  const invoice = await prisma.invoice.create({
    data: {
      userId,
      clientId: client.id,
      invoiceNo,
      subtotal,
      gstRate,
      gstAmount,
      totalAmount,
      description: items.map((i) => i.name).join(', '),
      lineItems: lineItems as any,
      notes,
      dueDate,
    },
  });

  // Generate PDF (with hard timeout — Puppeteer can hang on low-memory containers)
  let pdfUrl = '';
  let pdfBuf: Buffer | undefined;
  try {
    const PDF_TIMEOUT_MS = 30000; // 30 seconds max
    const pdfPromise = generateInvoicePDF({
      invoiceNo,
      createdAt: invoice.createdAt,
      dueDate,
      businessName: user.businessName,
      businessAddress: user.businessAddress || undefined,
      businessGstin: user.gstin || undefined,
      businessPhone: user.phone,
      businessUpiId: user.upiId || undefined,
      bankAccountNo: user.bankAccountNo || undefined,
      bankIfsc: user.bankIfsc || undefined,
      bankAccountName: user.bankAccountName || undefined,
      bankName: user.bankName || undefined,
      clientName: client.name,
      clientPhone: client.phone || undefined,
      clientGstin: (client as any).gstin || undefined,
      lineItems,
      subtotal,
      gstRate,
      gstAmount,
      totalAmount,
      notes: notes || undefined,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('PDF generation timed out after 30s')), PDF_TIMEOUT_MS)
    );

    pdfBuf = await Promise.race([pdfPromise, timeoutPromise]);
    pdfUrl = await savePDFLocally(invoiceNo, pdfBuf);
  } catch (error: any) {
    logger.error('PDF generation failed for invoice', { invoiceNo, errorMessage: error?.message });
    // Invoice is still created — PDF will be missing but invoice is functional
  }

  // Generate UPI payment link (zero MDR — money goes directly to merchant's bank)
  let paymentLink = '';
  let upiLink = '';
  try {
    if (user.upiId) {
      const paymentInfo = await generatePaymentInfo({
        upiId: user.upiId,
        payeeName: user.businessName,
        amount: totalAmount,
        invoiceNo,
      });
      upiLink = paymentInfo.upiLink;
      // Use the UPI link as the payment link (opens GPay/PhonePe/Paytm directly)
      paymentLink = upiLink;
    }
  } catch (error) {
    logger.error('UPI payment info generation failed', { invoiceNo, error });
  }

  // Update invoice with PDF URL and UPI link
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { pdfUrl, paymentLink, upiLink },
  });

  // Update client totals
  await prisma.client.update({
    where: { id: client.id },
    data: {
      totalInvoiced: { increment: totalAmount },
    },
  });

  logger.info('Invoice created', { invoiceNo, totalAmount, clientName });

  return {
    id: invoice.id,
    invoiceNo,
    totalAmount,
    pdfUrl,
    pdfBuffer: pdfBuf,
    paymentLink,
    clientId: client.id,
  };
}

/**
 * Record a payment (partial or full) against an invoice
 */
export async function recordPayment(params: {
  invoiceId: string;
  amount: number;
  paymentMethod?: string;
  transactionId?: string;
  notes?: string;
}): Promise<{
  invoice: any;
  payment: any;
  isFullyPaid: boolean;
  balanceDue: number;
}> {
  const { invoiceId, amount, paymentMethod, transactionId, notes } = params;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: true },
  });

  if (!invoice) throw new Error('Invoice not found');

  const totalAmount = Number(invoice.totalAmount);
  const currentPaid = Number(invoice.amountPaid);
  const balanceBefore = totalAmount - currentPaid;

  // Cap payment at balance due (no overpayments)
  const paymentAmount = Math.min(amount, balanceBefore);
  if (paymentAmount <= 0) {
    throw new Error('Invoice is already fully paid');
  }

  const newAmountPaid = currentPaid + paymentAmount;
  const isFullyPaid = newAmountPaid >= totalAmount;
  const balanceDue = Math.max(0, totalAmount - newAmountPaid);

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      invoiceId,
      amount: paymentAmount,
      paymentMethod: paymentMethod || 'manual',
      transactionId,
      notes,
    },
  });

  // Update invoice
  const updatedInvoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid: newAmountPaid,
      status: isFullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID,
      paidAt: isFullyPaid ? new Date() : undefined,
      paymentMethod: isFullyPaid ? (paymentMethod || 'manual') : undefined,
    },
    include: { client: true, payments: true },
  });

  // Update client payment stats
  await prisma.client.update({
    where: { id: invoice.clientId },
    data: {
      totalPaid: { increment: paymentAmount },
    },
  });

  // Recalculate client payment score if fully paid
  if (isFullyPaid) {
    await recalculatePaymentScore(invoice.clientId);
  }

  logger.info('Payment recorded', {
    invoiceNo: invoice.invoiceNo,
    paymentAmount,
    totalPaid: newAmountPaid,
    balanceDue,
    isFullyPaid,
  });

  return { invoice: updatedInvoice, payment, isFullyPaid, balanceDue };
}

/**
 * Mark an invoice as fully paid (convenience wrapper)
 */
export async function markInvoicePaid(
  invoiceId: string,
  paymentMethod: string = 'manual',
  transactionId?: string
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error('Invoice not found');

  const balanceDue = Number(invoice.totalAmount) - Number(invoice.amountPaid);
  await recordPayment({
    invoiceId,
    amount: balanceDue,
    paymentMethod,
    transactionId,
  });
}

/**
 * Get payment history for an invoice
 */
export async function getPaymentHistory(invoiceId: string) {
  return prisma.payment.findMany({
    where: { invoiceId },
    orderBy: { paidAt: 'desc' },
  });
}

/**
 * Find pending/partially-paid invoices for a client by name
 */
export async function findPendingInvoicesForClient(
  userId: string,
  clientName: string
): Promise<any[]> {
  return prisma.invoice.findMany({
    where: {
      userId,
      status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
      client: { name: { contains: clientName, mode: 'insensitive' } },
    },
    include: { client: true, payments: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get invoice by invoice number
 */
export async function getInvoiceByNumber(invoiceNo: string, userId: string) {
  return prisma.invoice.findUnique({
    where: { userId_invoiceNo: { userId, invoiceNo } },
    include: { client: true, user: true },
  });
}

/**
 * Find or create a client for a user
 */
async function findOrCreateClient(
  userId: string,
  name: string,
  phone?: string
): Promise<{ id: string; name: string; phone: string | null }> {
  // Try to find by phone first (most reliable)
  if (phone) {
    const existing = await prisma.client.findFirst({
      where: { userId, phone },
    });
    if (existing) return existing;
  }

  // Try to find by name (fuzzy match)
  const byName = await prisma.client.findFirst({
    where: {
      userId,
      name: { contains: name, mode: 'insensitive' },
    },
  });
  if (byName) return byName;

  // Create new client
  const client = await prisma.client.create({
    data: {
      userId,
      name,
      phone: phone || null,
    },
  });

  return client;
}

/**
 * Recalculate a client's payment score based on history
 */
async function recalculatePaymentScore(clientId: string): Promise<void> {
  const paidInvoices = await prisma.invoice.findMany({
    where: { clientId, status: InvoiceStatus.PAID, paidAt: { not: null } },
    select: { createdAt: true, paidAt: true, dueDate: true },
  });

  if (paidInvoices.length === 0) return;

  let totalDaysLate = 0;
  for (const inv of paidInvoices) {
    const dueDate = new Date(inv.dueDate);
    const paidAt = inv.paidAt!;
    const daysLate = Math.max(0, Math.floor(
      (paidAt.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
    ));
    totalDaysLate += daysLate;
  }

  const avgDaysLate = totalDaysLate / paidInvoices.length;

  let score: number;
  if (avgDaysLate <= 0) score = 5.0;
  else if (avgDaysLate <= 3) score = 4.0;
  else if (avgDaysLate <= 7) score = 3.0;
  else if (avgDaysLate <= 15) score = 2.0;
  else score = 1.0;

  const avgDaysToPay = paidInvoices.reduce((sum, inv) => {
    return sum + Math.floor(
      (inv.paidAt!.getTime() - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
  }, 0) / paidInvoices.length;

  await prisma.client.update({
    where: { id: clientId },
    data: { paymentScore: score, avgDaysToPay },
  });
}
