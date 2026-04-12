/**
 * BillKaro Systems Health Check
 * Tests: Database, OpenAI NLU, OpenAI Whisper, WhatsApp Meta API, PDF Generation, UPI Link
 */

import { config } from './src/config';

const API_BASE = `http://localhost:${config.PORT}`;
const RESULTS: { test: string; status: string; detail: string }[] = [];

function log(test: string, status: 'PASS' | 'FAIL' | 'WARN', detail: string) {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} [${test}] ${detail}`);
  RESULTS.push({ test, status, detail });
}

async function testDatabase() {
  console.log('\n━━━ 1. DATABASE (PostgreSQL) ━━━');
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    // Test connection
    await prisma.$queryRaw`SELECT 1 as ok`;
    log('DB Connection', 'PASS', 'PostgreSQL connection successful');
    
    // Test table existence
    const tables = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    ` as any[];
    log('DB Tables', 'PASS', `Tables found: ${tables.map((t: any) => t.table_name).join(', ')}`);
    
    // Test user count
    const userCount = await prisma.user.count();
    log('DB Users', 'PASS', `User count: ${userCount}`);
    
    await prisma.$disconnect();
  } catch (error: any) {
    log('DB Connection', 'FAIL', error.message);
  }
}

async function testRedis() {
  console.log('\n━━━ 2. REDIS ━━━');
  try {
    const IORedis = require('ioredis');
    const redis = new IORedis(config.REDIS_URL);
    
    await redis.set('billkaro_test', 'ok');
    const val = await redis.get('billkaro_test');
    await redis.del('billkaro_test');
    
    if (val === 'ok') {
      log('Redis', 'PASS', 'Read/write test successful');
    } else {
      log('Redis', 'FAIL', `Expected 'ok', got '${val}'`);
    }
    
    await redis.quit();
  } catch (error: any) {
    log('Redis', 'FAIL', error.message);
  }
}

async function testOpenAI_NLU() {
  console.log('\n━━━ 3. OPENAI NLU (GPT-4o-mini) ━━━');
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI.default({ apiKey: config.OPENAI_API_KEY });
    
    const testInput = 'Bill 5000 to Rahul for AC repair';
    
    const response = await openai.chat.completions.create({
      model: config.OPENAI_NLU_MODEL,
      messages: [
        { 
          role: 'system', 
          content: 'Extract invoice data as JSON: {"clientName": string, "amount": number, "items": [{"name": string, "quantity": number, "rate": number}]}. Return ONLY valid JSON.' 
        },
        { role: 'user', content: testInput },
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      log('OpenAI NLU', 'FAIL', 'Empty response from GPT');
      return;
    }
    
    const parsed = JSON.parse(content);
    log('OpenAI NLU', 'PASS', `Model: ${config.OPENAI_NLU_MODEL} | Parsed: client="${parsed.clientName}", amount=${parsed.amount}`);
    
    // Validate extraction accuracy
    if (parsed.clientName?.toLowerCase().includes('rahul') && parsed.amount === 5000) {
      log('NLU Accuracy', 'PASS', 'Correctly extracted client name and amount');
    } else {
      log('NLU Accuracy', 'WARN', `Expected Rahul/5000, got ${parsed.clientName}/${parsed.amount}`);
    }
  } catch (error: any) {
    log('OpenAI NLU', 'FAIL', error.message);
  }
}

async function testOpenAI_Whisper() {
  console.log('\n━━━ 4. OPENAI WHISPER (Voice-to-Text) ━━━');
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI.default({ apiKey: config.OPENAI_API_KEY });
    
    // We can't test actual transcription without an audio file, 
    // but we verify the API key works by checking model accessibility
    const models = await openai.models.list();
    const whisperAvailable = models.data.some((m: any) => m.id === 'whisper-1');
    
    if (whisperAvailable) {
      log('Whisper API', 'PASS', `Model whisper-1 is available and accessible`);
    } else {
      log('Whisper API', 'WARN', 'whisper-1 model not found in API list, but may still work');
    }
  } catch (error: any) {
    log('Whisper API', 'FAIL', error.message);
  }
}

async function testWhatsAppMeta() {
  console.log('\n━━━ 5. META WHATSAPP CLOUD API ━━━');
  try {
    // Test WABA phone number info retrieval
    const url = `https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}`;
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
      },
    });
    
    const data = await response.json() as any;
    
    if (response.ok) {
      log('WhatsApp API', 'PASS', `Phone: ${data.display_phone_number || data.verified_name || 'Connected'} | API: ${config.WHATSAPP_API_VERSION}`);
      if (data.verified_name) {
        log('WA Business Name', 'PASS', `Verified: "${data.verified_name}"`);
      }
    } else {
      const errMsg = data.error?.message || JSON.stringify(data);
      if (data.error?.code === 190) {
        log('WhatsApp API', 'FAIL', `Access token expired or invalid: ${errMsg}`);
      } else {
        log('WhatsApp API', 'FAIL', `API error (${response.status}): ${errMsg}`);
      }
    }
  } catch (error: any) {
    log('WhatsApp API', 'FAIL', error.message);
  }
}

async function testPDFGeneration() {
  console.log('\n━━━ 6. PDF GENERATION (PDFKit) ━━━');
  try {
    const { generateInvoicePDF, savePDFLocally } = require('./src/services/pdf.service');
    
    const testData = {
      invoiceNo: 'BK-TEST-001',
      createdAt: new Date(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      businessName: 'Test Business Pvt Ltd',
      businessAddress: '123 Test Street, Mumbai',
      businessGstin: '27AAPCS1234F1Z5',
      businessPhone: '919999999999',
      businessUpiId: 'test@upi',
      clientName: 'Test Client Corp',
      clientPhone: '919888888888',
      lineItems: [
        { name: 'AC Repair', quantity: 1, rate: 5000, amount: 5000 },
        { name: 'Gas Refill', quantity: 2, rate: 500, amount: 1000 },
      ],
      subtotal: 6000,
      gstRate: 18,
      gstAmount: 1080,
      totalAmount: 7080,
      notes: 'Test invoice for system health check',
      status: 'PENDING' as const,
    };

    const startTime = Date.now();
    const pdfBuffer = await generateInvoicePDF(testData);
    const genTime = Date.now() - startTime;
    
    if (pdfBuffer && pdfBuffer.length > 0) {
      log('PDF Generation', 'PASS', `Generated in ${genTime}ms | Size: ${(pdfBuffer.length / 1024).toFixed(1)}KB`);
      
      // Verify it's a valid PDF (starts with %PDF)
      const header = pdfBuffer.toString('utf8', 0, 5);
      if (header === '%PDF-') {
        log('PDF Validity', 'PASS', 'Valid PDF header detected');
      } else {
        log('PDF Validity', 'WARN', `Unexpected header: ${header}`);
      }
      
      // Save to disk
      const savedPath = await savePDFLocally('BK-TEST-001', pdfBuffer);
      log('PDF Save', 'PASS', `Saved to: ${savedPath}`);
    } else {
      log('PDF Generation', 'FAIL', 'Empty PDF buffer returned');
    }
  } catch (error: any) {
    log('PDF Generation', 'FAIL', error.message);
  }
}

async function testUPILink() {
  console.log('\n━━━ 7. UPI LINK GENERATION ━━━');
  try {
    const { generateUPILink, generateUPIQRCode } = require('./src/utils/upi');
    
    const upiLink = generateUPILink({
      upiId: 'test@upi',
      payeeName: 'Test Business',
      amount: 7080,
      transactionNote: 'Invoice BK-TEST-001',
    });
    
    if (upiLink && upiLink.startsWith('upi://pay')) {
      log('UPI Link', 'PASS', `Generated: ${upiLink.substring(0, 80)}...`);
    } else {
      log('UPI Link', 'FAIL', `Unexpected format: ${upiLink}`);
    }
    
    // Test QR code generation
    const qrDataUrl = await generateUPIQRCode({
      upiId: 'test@upi',
      payeeName: 'Test Business',
      amount: 7080,
      transactionNote: 'Invoice BK-TEST-001',
    });
    
    if (qrDataUrl && qrDataUrl.startsWith('data:image')) {
      log('UPI QR Code', 'PASS', `QR generated (${(qrDataUrl.length / 1024).toFixed(1)}KB data URL)`);
    } else {
      log('UPI QR Code', 'FAIL', 'QR code generation failed');
    }
  } catch (error: any) {
    log('UPI Link', 'FAIL', error.message);
  }
}

async function testWebhookEndpoint() {
  console.log('\n━━━ 8. WEBHOOK ENDPOINT ━━━');
  try {
    // Test webhook verification (GET request with challenge)
    const verifyUrl = `${API_BASE}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${config.WHATSAPP_VERIFY_TOKEN}&hub.challenge=test_challenge_123`;
    
    const response = await fetch(verifyUrl);
    const body = await response.text();
    
    if (response.ok && body === 'test_challenge_123') {
      log('Webhook Verify', 'PASS', 'Challenge verification works correctly');
    } else {
      log('Webhook Verify', 'FAIL', `Expected challenge echo, got: ${body.substring(0, 100)}`);
    }
  } catch (error: any) {
    log('Webhook Verify', 'FAIL', error.message);
  }
}

async function testDashboardAPI() {
  console.log('\n━━━ 9. DASHBOARD API ━━━');
  try {
    // Test auth endpoint (OTP request)
    const otpRes = await fetch(`${API_BASE}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '919999999999' }),
    });
    const otpData = await otpRes.json() as any;
    
    if (otpRes.ok) {
      log('Auth OTP', 'PASS', `OTP request accepted | ${otpData.message || 'Success'}`);
      // In dev mode, OTP might be in response
      if (otpData.otp) {
        log('Auth OTP (Dev)', 'PASS', `Dev OTP returned: ${otpData.otp}`);
      }
    } else {
      log('Auth OTP', 'WARN', `Response: ${JSON.stringify(otpData)}`);
    }
  } catch (error: any) {
    log('Dashboard API', 'FAIL', error.message);
  }
}

async function testFullInvoiceFlow() {
  console.log('\n━━━ 10. FULL INVOICE FLOW (End-to-End) ━━━');
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    // Create a test user
    const user = await prisma.user.upsert({
      where: { phone: '919999999999' },
      update: {},
      create: {
        phone: '919999999999',
        businessName: 'Test HVAC Solutions',
        gstin: '27AAPCS1234F1Z5',
        upiId: 'testhvac@paytm',
        businessAddress: '123 Test Street, Delhi',
        onboardingComplete: true,
        defaultPaymentTermsDays: 7,
        defaultGstRate: 18,
      },
    });
    log('E2E Setup', 'PASS', `Test user created: ${user.businessName} (${user.id.substring(0, 8)}...)`);
    
    // Create invoice via the service
    const { createInvoice } = require('./src/services/invoice.service');
    
    const invoice = await createInvoice({
      userId: user.id,
      clientName: 'Rahul Sharma',
      clientPhone: '919888888888',
      amount: 5000,
      items: [{ name: 'AC Repair', quantity: 1, rate: 5000 }],
      notes: 'Sector 45 site',
    });
    
    log('E2E Invoice Create', 'PASS', `Invoice #${invoice.invoiceNo} | Total: ₹${invoice.totalAmount}`);
    
    if (invoice.pdfUrl) {
      log('E2E PDF', 'PASS', `PDF URL: ${invoice.pdfUrl}`);
    } else {
      log('E2E PDF', 'WARN', 'No PDF URL generated');
    }
    
    if (invoice.paymentLink) {
      log('E2E Payment', 'PASS', `UPI Link: ${invoice.paymentLink.substring(0, 60)}...`);
    } else {
      log('E2E Payment', 'WARN', 'No payment/UPI link generated');
    }
    
    // Verify in DB
    const dbInvoice = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: { client: true },
    });
    
    if (dbInvoice) {
      log('E2E DB Verify', 'PASS', `DB record OK | Client: ${dbInvoice.client.name} | Status: ${dbInvoice.status}`);
    } else {
      log('E2E DB Verify', 'FAIL', 'Invoice not found in database');
    }
    
    await prisma.$disconnect();
  } catch (error: any) {
    log('E2E Invoice', 'FAIL', `${error.message}\n  Stack: ${error.stack?.split('\n')[1]}`);
  }
}


// ── Run all tests ──────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  🧾 BillKaro — Systems Health Check             ║');
  console.log('║  Testing all integrations...                    ║');
  console.log('╚══════════════════════════════════════════════════╝');

  await testDatabase();
  await testRedis();
  await testOpenAI_NLU();
  await testOpenAI_Whisper();
  await testWhatsAppMeta();
  await testPDFGeneration();
  await testUPILink();
  await testWebhookEndpoint();
  await testDashboardAPI();
  await testFullInvoiceFlow();

  // Summary
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  📊 RESULTS SUMMARY                             ║');
  console.log('╚══════════════════════════════════════════════════╝');
  
  const passes = RESULTS.filter(r => r.status === 'PASS').length;
  const fails = RESULTS.filter(r => r.status === 'FAIL').length;
  const warns = RESULTS.filter(r => r.status === 'WARN').length;
  
  console.log(`\n  ✅ PASS: ${passes}  |  ❌ FAIL: ${fails}  |  ⚠️ WARN: ${warns}  |  Total: ${RESULTS.length}`);
  
  if (fails > 0) {
    console.log('\n  ❌ FAILURES:');
    RESULTS.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`     • ${r.test}: ${r.detail}`);
    });
  }
  
  if (warns > 0) {
    console.log('\n  ⚠️ WARNINGS:');
    RESULTS.filter(r => r.status === 'WARN').forEach(r => {
      console.log(`     • ${r.test}: ${r.detail}`);
    });
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(fails > 0 ? 1 : 0);
}

main();
