import { z } from 'zod';
import dotenv from 'dotenv';

// Only load .env file in development — production uses injected env vars
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '../.env' });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default('http://localhost:4000'),
  DASHBOARD_URL: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('7d'),

  WHATSAPP_PHONE_NUMBER_ID: z.string(),
  WHATSAPP_ACCESS_TOKEN: z.string(),
  WHATSAPP_VERIFY_TOKEN: z.string(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default(''),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  META_APP_SECRET: z.string().default(''),

  OPENAI_API_KEY: z.string(),
  OPENAI_NLU_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_WHISPER_MODEL: z.string().default('whisper-1'),

  // Google Gemini (FREE tier for screenshot analysis — get key at aistudio.google.com)
  GEMINI_API_KEY: z.string().default(''),

  // No payment gateway needed — direct UPI + bank transfer (zero MDR)

  S3_ENDPOINT: z.string().default(''),
  S3_BUCKET: z.string().default('billkaro-invoices'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_PUBLIC_URL: z.string().default(''),

  DEFAULT_GST_RATE: z.coerce.number().default(18),
  DEFAULT_PAYMENT_TERMS_DAYS: z.coerce.number().default(7),
  INVOICE_PREFIX: z.string().default('BK'),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}

export const config = loadConfig();
export type Config = z.infer<typeof envSchema>;
