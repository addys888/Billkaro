import { prisma } from '../db/prisma';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { getCurrentFinancialYear } from './dates';



/**
 * Generate the next sequential invoice number for a user
 * Format: BK-2026-0001
 */
export async function generateInvoiceNumber(userId: string): Promise<string> {
  const prefix = config.INVOICE_PREFIX;
  const year = new Date().getFullYear();

  // Find the highest existing invoice number for this user in the current FY
  const currentFY = getCurrentFinancialYear();
  const fyStartYear = parseInt(currentFY.split('-')[0], 10);
  const fyStart = new Date(fyStartYear, 3, 1); // April 1st

  const latestInvoice = await prisma.invoice.findFirst({
    where: {
      userId,
      createdAt: { gte: fyStart },
    },
    orderBy: { createdAt: 'desc' },
    select: { invoiceNo: true },
  });

  let nextNum = 1;
  if (latestInvoice?.invoiceNo) {
    // Extract the number part (e.g., "BK-2026-0003" → 3)
    const parts = latestInvoice.invoiceNo.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) {
      nextNum = lastNum + 1;
    }
  }

  const nextNumber = nextNum.toString().padStart(4, '0');
  return `${prefix}-${year}-${nextNumber}`;
}

/**
 * Validate an invoice number format
 */
export function isValidInvoiceNumber(invoiceNo: string): boolean {
  return /^[A-Z]{2,4}-\d{4}-\d{4,}$/.test(invoiceNo);
}
