import QRCode from 'qrcode';

/**
 * Generate a UPI deep link URL
 */
export function generateUPILink(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  transactionNote: string;
}): string {
  const { upiId, payeeName, amount, transactionNote } = params;
  const encodedName = encodeURIComponent(payeeName);
  const encodedNote = encodeURIComponent(transactionNote);

  return `upi://pay?pa=${upiId}&pn=${encodedName}&am=${amount.toFixed(2)}&tn=${encodedNote}&cu=INR`;
}

/**
 * Generate a UPI QR code as a base64 data URL
 */
export async function generateUPIQRCode(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  transactionNote: string;
}): Promise<string> {
  const upiLink = generateUPILink(params);

  const qrDataUrl = await QRCode.toDataURL(upiLink, {
    width: 200,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'M',
  });

  return qrDataUrl;
}
