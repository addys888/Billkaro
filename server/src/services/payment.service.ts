import { generateUPILink, generateUPIQRCode } from '../utils/upi';
import { logger } from '../utils/logger';

interface GeneratePaymentInfoParams {
  upiId: string;
  payeeName: string;
  amount: number;
  invoiceNo: string;
}

interface PaymentInfo {
  upiLink: string;
  qrCodeDataUrl: string;
}

/**
 * Generate direct UPI payment info for an invoice (zero MDR!)
 *
 * Instead of using a payment gateway like Razorpay (which charges 1.5-2% MDR),
 * we generate a dynamic UPI Intent URL that opens the client's UPI app
 * with the amount pre-filled. Money goes directly to the merchant's bank account.
 */
export async function generatePaymentInfo(params: GeneratePaymentInfoParams): Promise<PaymentInfo> {
  const { upiId, payeeName, amount, invoiceNo } = params;

  try {
    const upiParams = {
      upiId,
      payeeName,
      amount,
      transactionNote: `Invoice ${invoiceNo}`,
    };

    const upiLink = generateUPILink(upiParams);
    const qrCodeDataUrl = await generateUPIQRCode(upiParams);

    logger.info('UPI payment info generated', { invoiceNo, upiId: upiId.slice(0, 5) + '***' });

    return { upiLink, qrCodeDataUrl };
  } catch (error) {
    logger.error('Failed to generate UPI payment info', { invoiceNo, error });
    throw error;
  }
}

/**
 * Format bank transfer details for display on invoice PDF + WhatsApp message
 */
export function formatBankDetails(params: {
  accountName?: string | null;
  accountNo?: string | null;
  ifsc?: string | null;
  bankName?: string | null;
}): string | null {
  const { accountName, accountNo, ifsc, bankName } = params;

  if (!accountNo || !ifsc) return null;

  const lines = [
    '🏦 *Bank Transfer (NEFT/IMPS):*',
    `Account Name: ${accountName || 'N/A'}`,
    `Account No: ${accountNo}`,
    `IFSC: ${ifsc}`,
    bankName ? `Bank: ${bankName}` : '',
  ].filter(Boolean);

  return lines.join('\n');
}
