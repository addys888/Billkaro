import { PrismaClient } from '@prisma/client';
import { sendTextMessage, sendButtonMessage, downloadMedia, markAsRead } from '../services/whatsapp.service';
import { classifyIntent } from '../services/nlu.service';
import { transcribeVoiceNote } from '../services/voice.service';
import { getSession } from './session-manager';
import { handleOnboardingStep } from './flows/onboarding.flow';
import { handleInvoiceFlow } from './flows/invoice.flow';
import { handleCommand } from './flows/command.flow';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

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
      const audioBuffer = await downloadMedia(message.audio.id);
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
        text: '👋 I can understand text messages, voice notes, and button taps.\n\nTo create an invoice, try:\n"Bill 5000 to Rahul for AC repair"',
      });
      return;
    }

    if (!text.trim()) return;

    // Check if this is a new user who needs onboarding
    const user = await prisma.user.findUnique({ where: { phone: senderPhone } });
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
  if (!user) return;

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
    case 'call_client':
    case 'send_final_reminder':
    case 'pause_reminders':
      await handleCommand(phone, buttonId, user);
      break;
    default:
      // Check onboarding buttons
      if (buttonId.startsWith('terms_')) {
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
    text: `👋 *Welcome to BillKaro!*\n\nHere's what I can do:\n\n📄 *Create Invoice:*\n"Bill 5000 to Rahul for AC repair"\n\n💰 *Check Pending:*\n"Kitna baaki hai" or "pending"\n\n✅ *Mark Paid:*\n"Rahul ne pay kar diya"\n\n⏸️ *Pause Reminders:*\n"Priya ke reminders band karo"\n\n📊 *Dashboard:*\nVisit app.billkaro.in\n\nJust type or send a voice note! 🎤`,
  });
}
