import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { getCurrentFinancialYear } from './dates';

const prisma = new PrismaClient();

/**
 * Generate the next sequential invoice number for a user
 * Format: BK-2026-0001
 */
export async function generateInvoiceNumber(userId: string): Promise<string> {
  const prefix = config.INVOICE_PREFIX;
  const year = new Date().getFullYear();

  // Count existing invoices for this user in the current financial year
  const currentFY = getCurrentFinancialYear();
  const fyStartYear = parseInt(currentFY.split('-')[0], 10);
  const fyStart = new Date(fyStartYear, 3, 1); // April 1st

  const count = await prisma.invoice.count({
    where: {
      userId,
      createdAt: { gte: fyStart },
    },
  });

  const nextNumber = (count + 1).toString().padStart(4, '0');
  return `${prefix}-${year}-${nextNumber}`;
}

/**
 * Validate an invoice number format
 */
export function isValidInvoiceNumber(invoiceNo: string): boolean {
  return /^[A-Z]{2,4}-\d{4}-\d{4,}$/.test(invoiceNo);
}
