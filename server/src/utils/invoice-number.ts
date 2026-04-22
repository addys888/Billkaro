import { prisma } from '../db/prisma';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { getCurrentFinancialYear } from './dates';


/**
 * Extract merchant initials from business name
 * Takes first char + last char, uppercased
 * "Adarsh" → "AH", "CelerApps" → "CS", "Raj Kumar" → "RR" (from "RajKumar")
 */
function getMerchantCode(businessName: string): string {
  // Remove spaces and special chars, keep only letters
  const clean = businessName.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (clean.length === 0) return 'XX';
  if (clean.length === 1) return clean + clean;
  return clean[0] + clean[clean.length - 1];
}

/**
 * Generate the next sequential invoice number for a user
 * Format: BK-{MerchantCode}-{YYMM}-{Sequence}
 * Example: BK-AH-2604-0001
 *
 * - BK = App prefix (configurable)
 * - AH = First + Last char of merchant's business name
 * - 2604 = Year(2-digit) + Month(2-digit)
 * - 0001 = Sequential number per merchant per FY
 *
 * Uses retry logic to handle concurrent invoice creation
 */
export async function generateInvoiceNumber(userId: string, businessName?: string): Promise<string> {
  const prefix = config.INVOICE_PREFIX;
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');

  // Get merchant code from business name
  let merchantCode = 'XX';
  if (businessName) {
    merchantCode = getMerchantCode(businessName);
  } else {
    // Fallback: look up user's business name
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { businessName: true },
    });
    if (user?.businessName) {
      merchantCode = getMerchantCode(user.businessName);
    }
  }

  // Find the highest existing invoice number for this user in the current FY
  const currentFY = getCurrentFinancialYear();
  const fyStartYear = parseInt(currentFY.split('-')[0], 10);
  const fyStart = new Date(fyStartYear, 3, 1); // April 1st

  // Retry up to 3 times to handle concurrent invoice creation
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
      // Extract the sequence part (last segment after final dash)
      const parts = latestInvoice.invoiceNo.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1 + attempt; // Add attempt offset to skip collisions
      }
    }

    const seq = nextNum.toString().padStart(4, '0');
    const invoiceNo = `${prefix}-${merchantCode}-${yy}${mm}-${seq}`;

    // Check if this number already exists (defensive)
    const existing = await prisma.invoice.findFirst({
      where: { userId, invoiceNo },
    });

    if (!existing) {
      return invoiceNo;
    }

    // Collision detected — retry with next number
  }

  // Fallback: use timestamp-based suffix if all retries fail
  const fallbackSeq = Date.now().toString().slice(-6);
  return `${prefix}-${merchantCode}-${yy}${mm}-${fallbackSeq}`;
}

/**
 * Validate an invoice number format
 * Supports both old (BK-2026-0001) and new (BK-AH-2604-0001) formats
 */
export function isValidInvoiceNumber(invoiceNo: string): boolean {
  return /^[A-Z]{2,4}-[A-Z0-9]{2,4}-\d{4}-\d{4,}$/.test(invoiceNo)
    || /^[A-Z]{2,4}-\d{4}-\d{4,}$/.test(invoiceNo);
}
