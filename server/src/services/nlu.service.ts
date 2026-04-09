import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

export interface ParsedInvoice {
  clientName: string;
  amount: number;
  items: Array<{
    name: string;
    quantity: number;
    rate: number;
  }>;
  notes: string | null;
  dueDays: number | null;
  gstRate: number | null;
}

const SYSTEM_PROMPT = `You are an invoice data extractor for Indian SMEs. Extract structured invoice data from natural language input (Hindi, English, or Hinglish).

Always return a JSON object with these fields:
{
  "clientName": string,
  "amount": number,
  "items": [{"name": string, "quantity": number, "rate": number}],
  "notes": string | null,
  "dueDays": number | null,
  "gstRate": number | null
}

Rules:
- If amount is mentioned in words ("paanch hazaar"), convert to number (5000)
- If no quantity mentioned, assume 1
- If no rate mentioned, use the total amount as the single line item rate
- "dueDays" only if explicitly mentioned, otherwise null
- "gstRate" only if explicitly mentioned (e.g. "5% GST", "GST 12%", "no GST", "zero GST"). In India, valid GST rates are 0, 5, 12, 18, 28. If user says "no GST" or "without GST" or "GST exempt", set gstRate to 0. If not mentioned at all, set to null.
- If multiple items mentioned without individual rates, split equally
- Clean up item names to be professional (capitalize, remove slang)
- Return ONLY valid JSON, no explanation, no markdown

Examples:
Input: "Bill 5000 to Rahul for AC repair"
Output: {"clientName":"Rahul","amount":5000,"items":[{"name":"AC Repair","quantity":1,"rate":5000}],"notes":null,"dueDays":null,"gstRate":null}

Input: "Priya ko 15000 ka bill, 10 CCTV camera install at 1500 each"
Output: {"clientName":"Priya","amount":15000,"items":[{"name":"CCTV Camera Installation","quantity":10,"rate":1500}],"notes":null,"dueDays":null,"gstRate":null}

Input: "Bill 8000 to Sharma ji for groceries at 5% GST"
Output: {"clientName":"Sharma Ji","amount":8000,"items":[{"name":"Groceries","quantity":1,"rate":8000}],"notes":null,"dueDays":null,"gstRate":5}

Input: "Rahul ko 50000 ka bill without GST, consulting fees"
Output: {"clientName":"Rahul","amount":50000,"items":[{"name":"Consulting Fees","quantity":1,"rate":50000}],"notes":null,"dueDays":null,"gstRate":0}`;

/**
 * Parse a natural language invoice request into structured data
 */
export async function parseInvoiceFromText(text: string): Promise<ParsedInvoice | null> {
  try {
    const response = await openai.chat.completions.create({
      model: config.OPENAI_NLU_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      logger.warn('NLU returned empty response', { text });
      return null;
    }

    const parsed = JSON.parse(content) as ParsedInvoice;

    // Validate required fields
    if (!parsed.clientName || !parsed.amount || parsed.amount <= 0) {
      logger.warn('NLU parsed invalid data', { text, parsed });
      return null;
    }

    // Ensure items array exists
    if (!parsed.items || parsed.items.length === 0) {
      parsed.items = [{ name: 'Service', quantity: 1, rate: parsed.amount }];
    }

    return parsed;
  } catch (error) {
    logger.error('NLU parsing failed', { text, error });
    return null;
  }
}

/**
 * Detect if a message is an invoice request or a command
 */
export async function classifyIntent(text: string): Promise<'invoice' | 'command' | 'unknown'> {
  try {
    const response = await openai.chat.completions.create({
      model: config.OPENAI_NLU_MODEL,
      messages: [
        {
          role: 'system',
          content: `Classify the user message as one of: "invoice", "command", or "unknown".
          
"invoice" = user wants to create a bill/invoice (mentions amount, client, work)
"command" = user wants to perform an action (mark paid, check pending, pause, help)
"unknown" = greeting, question, or unclear intent

Return ONLY the classification word, nothing else.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    const intent = response.choices[0]?.message?.content?.trim().toLowerCase();
    if (intent === 'invoice' || intent === 'command') return intent;
    return 'unknown';
  } catch (error) {
    logger.error('Intent classification failed', { text, error });
    return 'unknown';
  }
}
