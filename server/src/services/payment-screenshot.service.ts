import { config } from '../config';
import { logger } from '../utils/logger';

export interface ExtractedPaymentInfo {
  utrNumber: string | null;
  amount: number | null;
  payerUpiId: string | null;
  payeeUpiId: string | null;
  payerName: string | null;
  payeeName: string | null;
  status: string | null;
  date: string | null;
  app: string | null;
}

const VISION_PROMPT = `You are a UPI payment screenshot analyzer. Extract payment details from this UPI payment receipt/screenshot.

Return a JSON object with these fields:
{
  "utrNumber": string | null,      // UPI Transaction ID / UTR number (12-digit number like "610376347092")
  "amount": number | null,          // Payment amount in rupees (e.g. 5000)
  "payerUpiId": string | null,     // Sender's UPI ID (e.g. "adarshsngh73@okaxis")
  "payeeUpiId": string | null,     // Receiver's UPI ID (e.g. "nitesh1989kd-1@oksbi")
  "payerName": string | null,      // Sender's name
  "payeeName": string | null,      // Receiver's name
  "status": string | null,         // Payment status: "completed", "failed", "pending"
  "date": string | null,           // Date in ISO format if visible
  "app": string | null             // UPI app used: "gpay", "phonepe", "paytm", etc.
}

Rules:
- Extract the UTR/UPI Transaction ID carefully — it's usually a 12-digit number
- Look for labels like "UPI transaction ID", "UPI Ref No", "UTR", "Transaction ID", "Reference Number"
- The amount should be a plain number without currency symbols
- If you see "Completed", "Success", "Successful", set status to "completed"
- If any field is not visible, set it to null
- Return ONLY valid JSON, no explanation, no markdown`;

/**
 * Analyze a UPI payment screenshot
 * Uses Google Gemini Flash (FREE) as primary, OpenAI GPT-4o as fallback
 */
export async function analyzePaymentScreenshot(imageBuffer: Buffer, mimeType: string): Promise<ExtractedPaymentInfo | null> {
  // Try Gemini first (FREE)
  if (config.GEMINI_API_KEY) {
    try {
      const result = await analyzeWithGemini(imageBuffer, mimeType);
      if (result) return result;
    } catch (err: any) {
      logger.warn('Gemini screenshot analysis failed, falling back to OpenAI', { error: err.message });
    }
  }

  // Fallback to OpenAI GPT-4o-mini with vision
  try {
    return await analyzeWithOpenAI(imageBuffer, mimeType);
  } catch (err: any) {
    logger.error('All screenshot analysis methods failed', { error: err.message });
    return null;
  }
}

/**
 * Google Gemini Flash — FREE tier (15 RPM, 1500 RPD)
 */
async function analyzeWithGemini(imageBuffer: Buffer, mimeType: string): Promise<ExtractedPaymentInfo | null> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 500,
      responseMimeType: 'application/json',
    },
  });

  const base64Image = imageBuffer.toString('base64');

  const result = await model.generateContent([
    VISION_PROMPT,
    {
      inlineData: {
        data: base64Image,
        mimeType,
      },
    },
  ]);

  const content = result.response.text();
  if (!content) {
    logger.warn('Gemini returned empty response');
    return null;
  }

  // Clean response — Gemini sometimes wraps in ```json ... ```
  const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(jsonStr) as ExtractedPaymentInfo;

  logger.info('Screenshot analyzed via Gemini (FREE)', {
    utr: parsed.utrNumber,
    amount: parsed.amount,
    status: parsed.status,
  });

  return parsed;
}

/**
 * OpenAI GPT-4o-mini with Vision — fallback (~₹0.30/call)
 */
async function analyzeWithOpenAI(imageBuffer: Buffer, mimeType: string): Promise<ExtractedPaymentInfo | null> {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const base64Image = imageBuffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${base64Image}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini', // Much cheaper than gpt-4o, still supports vision
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          {
            type: 'image_url',
            image_url: {
              url: dataUri,
              detail: 'high',
            },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    logger.warn('OpenAI Vision returned empty response');
    return null;
  }

  const parsed = JSON.parse(content) as ExtractedPaymentInfo;

  logger.info('Screenshot analyzed via OpenAI (fallback)', {
    utr: parsed.utrNumber,
    amount: parsed.amount,
    status: parsed.status,
  });

  return parsed;
}

/**
 * Validate extracted payment info against invoice data
 */
export function validatePaymentAgainstInvoice(
  extracted: ExtractedPaymentInfo,
  balanceDue: number,
  merchantUpiId: string | null,
  totalAmount?: number,
): {
  isValid: boolean;
  paymentAmount: number;
  isPartial: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  let paymentAmount = balanceDue; // default to full balance
  let isPartial = false;

  // 1. Check status
  if (extracted.status && extracted.status !== 'completed') {
    errors.push(`Payment status is "${extracted.status}", not completed`);
  }

  // 2. Check UTR exists
  if (!extracted.utrNumber) {
    errors.push('Could not extract UTR/Transaction ID from screenshot');
  }

  // 3. Determine payment amount from screenshot
  if (extracted.amount && extracted.amount > 0) {
    if (extracted.amount > balanceDue + 1) {
      // Overpayment — cap at balance due, warn
      warnings.push(`Screenshot shows ₹${extracted.amount} but balance due is only ₹${balanceDue}. Recording ₹${balanceDue}.`);
      paymentAmount = balanceDue;
    } else if (Math.abs(extracted.amount - balanceDue) <= 1) {
      // Full payment (within rounding)
      paymentAmount = balanceDue;
      isPartial = false;
    } else {
      // Partial payment — use the screenshot amount
      paymentAmount = extracted.amount;
      isPartial = true;
    }
  } else {
    warnings.push('Could not extract amount from screenshot. Recording full balance due.');
    paymentAmount = balanceDue;
  }

  // 4. Check payee UPI ID matches merchant
  if (merchantUpiId && extracted.payeeUpiId) {
    const normalizedMerchant = merchantUpiId.toLowerCase().trim();
    const normalizedPayee = extracted.payeeUpiId.toLowerCase().trim();
    if (normalizedMerchant !== normalizedPayee) {
      warnings.push(`Payee UPI (${extracted.payeeUpiId}) doesn't match your UPI (${merchantUpiId})`);
    }
  }

  return {
    isValid: errors.length === 0,
    paymentAmount,
    isPartial,
    errors,
    warnings,
  };
}
