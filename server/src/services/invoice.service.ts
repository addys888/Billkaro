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
}

interface InvoiceResult {
  id: string;
  invoiceNo: string;
  totalAmount: number;
  pdfUrl: string;
  paymentLink: string;
  clientId: string;
}

/**
 * Create a complete invoice: DB record + PDF + payment link
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
  const { userId, clientName, clientPhone, amount, items, notes, dueDays } = params;

  // Get user details
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  // Find or create client
  let client = await findOrCreateClient(userId, clientName, clientPhone);

  // Calculate amounts
  const gstRate = Number(user.defaultGstRate);
  const subtotal = amount;
  const gstAmount = Math.round((subtotal * gstRate) / 100 * 100) / 100;
  const totalAmount = subtotal + gstAmount;

  // Generate invoice number
  console.log('step 1', new Date());
  const invoiceNo = await generateInvoiceNumber(userId);
  console.log('step 2', new Date());

  // Calculate due date
  const paymentTerms = dueDays || user.defaultPaymentTermsDays;
  const dueDate = calculateDueDate(new Date(), paymentTerms);
  console.log('step 3', new Date());

  // Prepare line items with amounts
  const lineItems = items.map((item) => ({
    ...item,
    amount: item.quantity * item.rate,
  }));

  console.log('step 4', new Date());
  
  const createData = {
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
  };
  console.log('Data to create:', JSON.stringify(createData, null, 2));

  // Create invoice record
  const invoice = await prisma.invoice.create({
    data: createData,
  });

  // Generate PDF
  let pdfUrl = '';
  try {
    const pdfBuffer = await generateInvoicePDF({
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

    pdfUrl = await savePDFLocally(invoiceNo, pdfBuffer);
  } catch (error) {
    logger.error('PDF generation failed for invoice', { invoiceNo, error });
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
    paymentLink,
    clientId: client.id,
  };
}

/**
 * Mark an invoice as paid
 */
export async function markInvoicePaid(
  invoiceId: string,
  paymentMethod: string = 'manual',
  transactionId?: string
): Promise<void> {
  const invoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.PAID,
      paidAt: new Date(),
      paymentMethod,
      transactionId,
    },
    include: { client: true },
  });

  // Update client payment stats
  const totalAmount = Number(invoice.totalAmount);
  const daysToPayCalc = Math.max(0, Math.floor(
    (new Date().getTime() - invoice.createdAt.getTime()) / (1000 * 60 * 60 * 24)
  ));

  await prisma.client.update({
    where: { id: invoice.clientId },
    data: {
      totalPaid: { increment: totalAmount },
    },
  });

  // Recalculate client payment score
  await recalculatePaymentScore(invoice.clientId);

  logger.info('Invoice marked as paid', { invoiceNo: invoice.invoiceNo, paymentMethod });
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
