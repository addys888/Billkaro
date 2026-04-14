import { prisma } from '../db/prisma';
import { PrismaClient } from '@prisma/client';
import { sendTextMessage, sendButtonMessage, downloadMedia, markAsRead } from '../services/whatsapp.service';
import { classifyIntent } from '../services/nlu.service';
import { transcribeVoiceNote } from '../services/voice.service';
import { getSession } from './session-manager';
import { handleOnboardingStep } from './flows/onboarding.flow';
import { handleInvoiceFlow } from './flows/invoice.flow';
import { handleCommand, handlePaymentButton } from './flows/command.flow';
import { formatCurrency } from '../utils/currency';
import { logger } from '../utils/logger';



/**
 * Main entry point for all incoming WhatsApp messages
 */
export async function handleIncomingMessage(message: any, senderPhone: string): Promise<void> {
  try {
    // Mark message as read
    if (message.id) {
      await markAsRead(message.id);
    }

    // Extract text from message (text or voice note)
    let text = '';

    if (message.type === 'text') {
      text = message.text?.body || '';
    } else if (message.type === 'audio') {
      // Voice note → transcribe
      try {
        logger.info('Voice note received, downloading media', { mediaId: message.audio.id, mimeType: message.audio.mime_type });
        const audioBuffer = await downloadMedia(message.audio.id);
        logger.info('Media downloaded, transcribing', { bufferSize: audioBuffer.length });
        const transcribed = await transcribeVoiceNote(audioBuffer, message.audio.mime_type);
        if (!transcribed) {
          await sendTextMessage({
            to: senderPhone,
            text: '❌ Sorry, I couldn\'t understand the voice note. Please try again or type your message.',
          });
          return;
        }
        text = transcribed;
        // Confirm transcription
        await sendTextMessage({
          to: senderPhone,
          text: `🎤 I heard: "${text}"`,
        });
      } catch (voiceError: any) {
        logger.error('Voice note processing failed', { 
          mediaId: message.audio.id,
          errorMessage: voiceError?.message,
          errorStack: voiceError?.stack,
        });
        await sendTextMessage({
          to: senderPhone,
          text: '❌ Could not process your voice note. Please try sending a text message instead.\n\nExample: "Bill 5000 to Rahul for AC repair"',
        });
        return;
      }
    } else if (message.type === 'image') {
      // Image received — could be a payment screenshot from client
      const imageId = message.image?.id;
      const mimeType = message.image?.mime_type || 'image/jpeg';
      if (imageId) {
        await handleImageMessage(senderPhone, imageId, mimeType);
        return;
      }
    } else if (message.type === 'interactive') {
      // Button reply
      const buttonId = message.interactive?.button_reply?.id;
      if (buttonId) {
        await handleInteractiveReply(senderPhone, buttonId);
        return;
      }
    } else {
      // Unsupported message type
      await sendTextMessage({
        to: senderPhone,
        text: '👋 I can understand text messages, voice notes, images, and button taps.\n\nTo create an invoice, try:\n"Bill 5000 to Rahul for AC repair"',
      });
      return;
    }

    if (!text.trim()) return;

    // Check if this is a new user who needs onboarding
    const user = await prisma.user.findUnique({ where: { phone: senderPhone } });
    
    // Block suspended users
    if (user && user.isSuspended) {
      await sendTextMessage({
        to: senderPhone,
        text: '🚫 *Account Suspended*\n\nYour BillKaro account is currently suspended. Access to both the dashboard and WhatsApp bot is restricted.\n\nPlease contact the administrator for more information.',
      });
      return;
    }

    // ── Handle client replies (UTR / payment confirmation) ──
    // If sender is NOT a registered user, check if they're a known client
    if (!user) {
      const isClientReply = await handleClientReply(senderPhone, text);
      if (isClientReply) return;
    }

    if (!user || !user.onboardingComplete) {
      await handleOnboardingStep(senderPhone, text, user);
      return;
    }

    // Check if there's an active flow/session
    const session = await getSession(senderPhone);
    if (session.currentFlow) {
      switch (session.currentFlow) {
        case 'invoice':
          await handleInvoiceFlow(senderPhone, text, user, session);
          return;
        case 'record_payment':
          // Payment amount input (e.g. "5000") — route to command handler
          await handleCommand(senderPhone, text, user);
          return;
        case 'onboarding':
          await handleOnboardingStep(senderPhone, text, user);
          return;
      }
    }

    // Classify intent for new messages
    const intent = await classifyIntent(text);

    switch (intent) {
      case 'invoice':
        await handleInvoiceFlow(senderPhone, text, user, session);
        break;
      case 'command':
        await handleCommand(senderPhone, text, user);
        break;
      default:
        await sendHelpMessage(senderPhone);
        break;
    }
  } catch (error: any) {
    logger.error('Message handler error', { 
      senderPhone, 
      errorMessage: error?.message,
      errorStack: error?.stack,
      error 
    });
    try {
      await sendTextMessage({
        to: senderPhone,
        text: '❌ Oops! Something went wrong. Please try again in a moment.',
      });
    } catch (_) {
      // Ignore errors when sending error message
    }
  }
}

/**
 * Handle interactive button replies
 */
async function handleInteractiveReply(phone: string, buttonId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || user.isSuspended) return;

  const session = await getSession(phone);

  switch (buttonId) {
    case 'confirm_send':
      await handleInvoiceFlow(phone, '__CONFIRM__', user, session);
      break;
    case 'edit_invoice':
      await handleInvoiceFlow(phone, '__EDIT__', user, session);
      break;
    case 'cancel_invoice':
      await handleInvoiceFlow(phone, '__CANCEL__', user, session);
      break;
    case 'send_to_client':
      await handleInvoiceFlow(phone, '__SEND_TO_CLIENT__', user, session);
      break;
    case 'done_invoice':
      // Just clear session — invoice is already created
      if (session) {
        const { clearSession } = await import('./session-manager');
        await clearSession(phone);
      }
      const { sendTextMessage } = await import('../services/whatsapp.service');
      await sendTextMessage({ to: phone, text: '✅ All done! Send another invoice anytime.' });
      break;
    case 'call_client':
    case 'send_final_reminder':
    case 'pause_reminders':
      await handleCommand(phone, buttonId, user);
      break;
    case 'edit_amount':
    case 'edit_client':
    case 'edit_items':
    case 'edit_gst':
      // Forward edit sub-menu button IDs directly to invoice flow
      await handleInvoiceFlow(phone, buttonId, user, session);
      break;
    case 'pay_full':
    case 'pay_partial':
      // Forward payment type buttons to payment flow
      await handlePaymentButton(phone, buttonId, user);
      break;

    default:
      // Check onboarding buttons (terms_7, terms_15, terms_30, bank_yes, bank_skip)
      if (buttonId.startsWith('terms_') || buttonId.startsWith('bank_')) {
        await handleOnboardingStep(phone, buttonId, user);
      }
      break;
  }
}

/**
 * Send help/welcome message
 */
async function sendHelpMessage(phone: string): Promise<void> {
  await sendTextMessage({
    to: phone,
    text: `👋 *Welcome to BillKaro!*\n\nHere's what I can do:\n\n📄 *Create Invoice:*\n"Bill 5000 to Rahul for AC repair"\n\n💰 *Check Pending:*\n"pending" or "kitna baaki hai"\n\n✅ *Record Payment:*\n"Paid #0004" or "Paid BK-MP-2604-0004"\n\n⏸️ *Pause Reminders:*\n"Pause #0004"\n\n📊 *Dashboard:*\nhttps://billkaro.celerapps.com\n\nJust type or send a voice note! 🎤`,
  });
}

/**
 * Handle replies from clients (non-registered users)
 * Detects UTR numbers and auto-records payments
 */
async function handleClientReply(clientPhone: string, text: string): Promise<boolean> {
  try {
    // Find the most recent pending invoice sent to this client phone
    // Query invoices directly (not via client) to avoid matching wrong merchant's client
    const invoice = await prisma.invoice.findFirst({
      where: {
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        sentToClient: true,
        client: { phone: clientPhone },
      },
      orderBy: { updatedAt: 'desc' },
      include: { user: true, client: true },
    });

    if (!invoice) {
      return false; // Not a known client — let normal flow handle
    }

    const client = invoice.client;
    const merchantPhone = invoice.user.phone;
    const totalAmount = Number(invoice.totalAmount);
    const amountPaid = Number(invoice.amountPaid || 0);
    const balanceDue = totalAmount - amountPaid;

    if (balanceDue <= 0) {
      await sendTextMessage({
        to: clientPhone,
        text: `✅ Hi ${client.name}! Invoice *#${invoice.invoiceNo}* is already fully paid. Thank you! 🙏\n\n— ${invoice.user.businessName}`,
      });
      return true;
    }

    // ── Check if message contains a UTR/Transaction ID ──
    // UTR patterns: 8-22 digit numbers, refs like "UPI123456789", "T2604131234"
    const cleaned = text.replace(/[\s\-\/]/g, '');
    const utrMatch = cleaned.match(/(?:UTR|REF|TXN|UPI)?\.?\s*([A-Za-z0-9]{8,22})/i);
    
    // Must contain at least 6 digits to be a UTR
    const hasEnoughDigits = utrMatch && (utrMatch[1].replace(/[^0-9]/g, '').length >= 6);

    if (!utrMatch || !hasEnoughDigits) {
      // Client sent something but not a UTR — give guidance
      await sendTextMessage({
        to: clientPhone,
        text: [
          `Hi ${client.name}! 👋`,
          '',
          `For invoice *#${invoice.invoiceNo}*:`,
          `💰 Balance due: *${formatCurrency(balanceDue)}*`,
          '',
          `After making payment, please reply with your *UTR/Transaction ID* (the reference number from your UPI app).`,
          '',
          `— ${invoice.user.businessName}`,
        ].join('\n'),
      });
      return true;
    }

    const utrNumber = utrMatch[1].toUpperCase();

    // ── Record the payment ──
    try {
      const { recordPayment } = await import('../services/invoice.service');
      const result = await recordPayment({
        invoiceId: invoice.id,
        amount: balanceDue,
        paymentMethod: 'upi',
        transactionId: utrNumber,
      });

      const newBalance = result.balanceDue;

      // ── Send thank you to client ──
      if (result.isFullyPaid) {
        const { cancelReminders } = await import('../services/reminder.service');
        await cancelReminders(invoice.id);

        await sendTextMessage({
          to: clientPhone,
          text: [
            `✅ *Payment Received — Thank You!* 🎉`,
            `━━━━━━━━━━━━━━━━━━`,
            `📄 Invoice: *#${invoice.invoiceNo}*`,
            `💵 Paid: ${formatCurrency(balanceDue)}`,
            `🔖 UTR: ${utrNumber}`,
            `📊 Status: *Fully Paid* ✅`,
            '',
            `Thank you for your prompt payment, ${client.name}! 🙏`,
            `— ${invoice.user.businessName}`,
          ].join('\n'),
        });
      } else {
        await sendTextMessage({
          to: clientPhone,
          text: [
            `✅ *Payment Received — Thank You!* 👍`,
            `━━━━━━━━━━━━━━━━━━`,
            `📄 Invoice: *#${invoice.invoiceNo}*`,
            `💵 Paid now: ${formatCurrency(balanceDue)}`,
            `🔖 UTR: ${utrNumber}`,
            `💰 Total paid: ${formatCurrency(Number(result.invoice.amountPaid))}`,
            `📊 Balance remaining: *${formatCurrency(newBalance)}*`,
            '',
            `Thank you, ${client.name}! Please clear the remaining balance by the due date. 🙏`,
            `— ${invoice.user.businessName}`,
          ].join('\n'),
        });
      }

      // ── Notify merchant ──
      await sendTextMessage({
        to: merchantPhone,
        text: [
          `💰 *Payment Received!*`,
          `━━━━━━━━━━━━━━━━━━`,
          `📄 Invoice: *#${invoice.invoiceNo}*`,
          `👤 Client: ${client.name}`,
          `💵 Amount: ${formatCurrency(balanceDue)}`,
          `🔖 UTR: ${utrNumber}`,
          result.isFullyPaid
            ? `📊 Status: *Fully Paid* ✅ | Reminders stopped.`
            : `📊 Balance due: *${formatCurrency(newBalance)}*`,
          '',
          `_Auto-recorded from client UTR submission._`,
          `_Verify UTR in your banking app if needed._`,
        ].join('\n'),
      });

      logger.info('Client UTR payment recorded', {
        clientPhone,
        invoiceNo: invoice.invoiceNo,
        utr: utrNumber,
        amount: balanceDue,
      });

      return true;
    } catch (payErr: any) {
      logger.error('Failed to record client UTR payment', { error: payErr.message });
      await sendTextMessage({
        to: clientPhone,
        text: `Thank you for sharing your payment details! We've notified ${invoice.user.businessName}. They will confirm shortly. 🙏`,
      });
      // Notify merchant even if auto-record fails
      await sendTextMessage({
        to: merchantPhone,
        text: `💰 ${client.name} claims payment for *#${invoice.invoiceNo}* with UTR: ${utrNumber}.\n\n_Auto-recording failed. Please verify and record manually via "Paid #${invoice.invoiceNo.split('-').pop()}"._`,
      });
      return true;
    }
  } catch (err: any) {
    logger.error('Client reply handler error', { error: err.message });
    return false;
  }
}

/**
 * Handle image messages — UPI payment screenshot analysis
 */
async function handleImageMessage(senderPhone: string, imageId: string, mimeType: string): Promise<void> {
  try {
    // Check if sender is a registered merchant
    const user = await prisma.user.findUnique({ where: { phone: senderPhone } });
    
    if (user) {
      // Merchant sent an image — not relevant for payment verification
      await sendTextMessage({
        to: senderPhone,
        text: '📷 I received your image, but I can only process text commands for invoicing.\n\n💡 To create an invoice, type:\n"Bill 5000 to Rahul for AC repair"',
      });
      return;
    }

    // Find the most recent pending invoice sent to this client phone
    // Query invoices directly (not via client) to avoid matching wrong merchant's client
    const invoice = await prisma.invoice.findFirst({
      where: {
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        sentToClient: true,
        client: { phone: senderPhone },
      },
      orderBy: { updatedAt: 'desc' },
      include: { user: true, client: true },
    });

    if (!invoice) {
      // Unknown sender — ignore image
      await sendTextMessage({
        to: senderPhone,
        text: '👋 Hi! To get started with BillKaro, please ask your business to send you an invoice first.',
      });
      return;
    }

    const client = invoice.client;
    const merchant = invoice.user;
    const totalAmount = Number(invoice.totalAmount);
    const amountPaid = Number(invoice.amountPaid || 0);
    const balanceDue = totalAmount - amountPaid;

    if (balanceDue <= 0) {
      await sendTextMessage({
        to: senderPhone,
        text: `✅ Hi ${client.name}! Invoice *#${invoice.invoiceNo}* is already fully paid. Thank you! 🙏\n\n— ${merchant.businessName}`,
      });
      return;
    }

    // ── Analyze the screenshot ──
    await sendTextMessage({
      to: senderPhone,
      text: '🔍 Analyzing your payment screenshot...',
    });

    const imageBuffer = await downloadMedia(imageId);

    const { analyzePaymentScreenshot, validatePaymentAgainstInvoice } = await import('../services/payment-screenshot.service');
    const extracted = await analyzePaymentScreenshot(imageBuffer, mimeType);

    if (!extracted) {
      await sendTextMessage({
        to: senderPhone,
        text: `❌ Sorry, I couldn't read the screenshot. Please send a clearer image or reply with your *UTR/Transaction ID* number.\n\n— ${merchant.businessName}`,
      });
      return;
    }

    // ── Validate extracted data ──
    const validation = validatePaymentAgainstInvoice(extracted, balanceDue, merchant.upiId, totalAmount);

    if (!validation.isValid) {
      const errorLines = validation.errors.map(e => `⚠️ ${e}`).join('\n');
      await sendTextMessage({
        to: senderPhone,
        text: [
          `❌ *Payment verification issue:*`,
          errorLines,
          '',
          `Please send a clearer screenshot or reply with your *UTR/Transaction ID* directly.`,
          `— ${merchant.businessName}`,
        ].join('\n'),
      });
      return;
    }

    // ── Record the payment ──
    const paymentAmount = validation.paymentAmount;
    const utrNumber = extracted.utrNumber || 'SCREENSHOT';
    const paymentDate = extracted.date || new Date().toISOString();

    // Store UTR + date in transactionId for dashboard UTR/REF column
    const transactionRef = extracted.utrNumber
      ? `${utrNumber} | ${paymentDate}`
      : `SCREENSHOT | ${paymentDate}`;

    try {
      const { recordPayment } = await import('../services/invoice.service');
      const result = await recordPayment({
        invoiceId: invoice.id,
        amount: paymentAmount,
        paymentMethod: 'upi',
        transactionId: transactionRef,
        notes: `Via screenshot | Payer: ${extracted.payerName || 'N/A'} | UPI: ${extracted.payerUpiId || 'N/A'} | Date: ${paymentDate}`,
      });

      const newBalance = result.balanceDue;
      const totalPaidNow = Number(result.invoice.amountPaid);

      // ── Send thank you to client ──
      const warningLines = validation.warnings.length > 0
        ? `\n⚠️ _${validation.warnings.join('. ')}_\n`
        : '';

      if (result.isFullyPaid) {
        const { cancelReminders } = await import('../services/reminder.service');
        await cancelReminders(invoice.id);

        await sendTextMessage({
          to: senderPhone,
          text: [
            `✅ *Payment Verified — Fully Paid!* 🎉`,
            `━━━━━━━━━━━━━━━━━━`,
            `📄 Invoice: *#${invoice.invoiceNo}*`,
            `💰 Invoice total: ${formatCurrency(totalAmount)}`,
            `💵 Paid: ${formatCurrency(paymentAmount)}`,
            `🔖 UTR: ${utrNumber}`,
            `🕐 Payment Date: ${paymentDate}`,
            `📊 Status: *Fully Paid* ✅`,
            warningLines,
            `🔔 No more reminders.`,
            '',
            `Thank you for your payment, ${client.name}! 🙏`,
            `— ${merchant.businessName}`,
          ].filter(Boolean).join('\n'),
        });
      } else {
        await sendTextMessage({
          to: senderPhone,
          text: [
            `✅ *Partial Payment Verified!* 👍`,
            `━━━━━━━━━━━━━━━━━━`,
            `📄 Invoice: *#${invoice.invoiceNo}*`,
            `💰 Invoice total: ${formatCurrency(totalAmount)}`,
            `💵 Paid now: ${formatCurrency(paymentAmount)}`,
            `🔖 UTR: ${utrNumber}`,
            `🕐 Payment Date: ${paymentDate}`,
            `💵 Total paid so far: ${formatCurrency(totalPaidNow)}`,
            `📊 *Balance remaining: ${formatCurrency(newBalance)}*`,
            warningLines,
            `Thank you, ${client.name}!`,
            `Please pay the remaining *${formatCurrency(newBalance)}* by the due date. 🙏`,
            `— ${merchant.businessName}`,
          ].filter(Boolean).join('\n'),
        });
      }

      // ── Notify merchant ──
      await sendTextMessage({
        to: merchant.phone,
        text: [
          `💰 *Payment Received (Screenshot Verified)!*`,
          `━━━━━━━━━━━━━━━━━━`,
          `📄 Invoice: *#${invoice.invoiceNo}*`,
          `👤 Client: ${client.name}`,
          `💵 Amount: ${formatCurrency(paymentAmount)}`,
          `🔖 UTR: ${utrNumber}`,
          `🕐 Payment Date: ${paymentDate}`,
          extracted.payerUpiId ? `📲 Payer UPI: ${extracted.payerUpiId}` : '',
          extracted.payerName ? `👤 Payer Name: ${extracted.payerName}` : '',
          extracted.app ? `📱 Via: ${extracted.app}` : '',
          '',
          result.isFullyPaid
            ? `📊 Status: *Fully Paid* ✅ — Out of ${formatCurrency(totalAmount)}, all received. Reminders stopped.`
            : `📊 Paid: ${formatCurrency(totalPaidNow)} / ${formatCurrency(totalAmount)} | *Balance: ${formatCurrency(newBalance)}*`,
          validation.warnings.length > 0 ? `\n⚠️ ${validation.warnings.join('\n⚠️ ')}` : '',
          '',
          `_Auto-verified from payment screenshot._`,
        ].filter(Boolean).join('\n'),
      });

      logger.info('Screenshot payment recorded', {
        clientPhone: senderPhone,
        invoiceNo: invoice.invoiceNo,
        utr: utrNumber,
        amount: paymentAmount,
        isPartial: validation.isPartial,
      });
    } catch (payErr: any) {
      logger.error('Failed to record screenshot payment', { error: payErr.message });
      await sendTextMessage({
        to: senderPhone,
        text: `Thank you for sharing your payment screenshot! We've notified ${merchant.businessName}. They will confirm shortly. 🙏`,
      });
      await sendTextMessage({
        to: merchant.phone,
        text: `📷 ${client.name} sent a payment screenshot for *#${invoice.invoiceNo}*.\n\n💵 Amount: ${formatCurrency(extracted.amount || 0)}\n🔖 UTR: ${extracted.utrNumber || 'N/A'}\n\n_Auto-recording failed. Please verify and record manually via "Paid #${invoice.invoiceNo.split('-').pop()}"._`,
      });
    }
  } catch (error: any) {
    logger.error('Image message handler error', { senderPhone, error: error.message });
  }
}
