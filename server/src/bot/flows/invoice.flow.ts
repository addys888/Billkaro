import { prisma } from '../../db/prisma';
import { User } from '@prisma/client';
import { sendTextMessage, sendButtonMessage, sendMediaMessage, uploadMedia } from '../../services/whatsapp.service';
import { parseInvoiceFromText, ParsedInvoice } from '../../services/nlu.service';
import { createInvoice } from '../../services/invoice.service';
import { scheduleReminders } from '../../services/reminder.service';
import { updateSession, clearSession } from '../session-manager';
import { formatCurrency } from '../../utils/currency';
import { formatDateShort, addDays } from '../../utils/dates';
import { generateUPILink } from '../../utils/upi';
import { formatBankDetails } from '../../services/payment.service';
import { getPDFBuffer } from '../../services/storage.service';
import { PrismaClient } from '@prisma/client';
import { config } from '../../config';
import { logger } from '../../utils/logger';

interface SessionData {
  currentFlow: string | null;
  currentStep: string | null;
  flowData: Record<string, any>;
}

/**
 * Handle the invoice creation flow
 */
export async function handleInvoiceFlow(
  phone: string,
  input: string,
  user: User,
  session: SessionData
): Promise<void> {
  const step = session.currentStep;

  // ── Handle button actions ──
  if (input === '__CONFIRM__') {
    await confirmAndSendInvoice(phone, user, session);
    return;
  }

  if (input === '__CANCEL__') {
    await clearSession(phone);
    await sendTextMessage({ to: phone, text: '❌ Invoice cancelled.' });
    return;
  }

  if (input === '__EDIT__') {
    await updateSession(phone, { currentStep: 'edit_choice' });
    await sendButtonMessage({
      to: phone,
      bodyText: 'What would you like to change?',
      buttons: [
        { id: 'edit_amount', title: '💰 Amount' },
        { id: 'edit_client', title: '👤 Client' },
        { id: 'edit_items', title: '📝 Items' },
      ],
    });
    return;
  }

  if (input === '__SEND_TO_CLIENT__') {
    await sendInvoiceToClient(phone, user, session);
    return;
  }

  if (input === '__ADVANCE_YES__') {
    await updateSession(phone, { currentStep: 'advance_enter_amount' });
    const total = formatCurrency(session.flowData.parsedInvoice?.amount || 0);
    await sendTextMessage({
      to: phone,
      text: `💰 How much advance did the client pay?\n\nInvoice total: ${total}\n\n_Send the advance amount (e.g. 5000):_`,
    });
    return;
  }

  if (input === '__ADVANCE_NO__') {
    // Full amount due — show send to client buttons
    await updateSession(phone, { currentStep: 'invoice_created' });
    await sendButtonMessage({
      to: phone,
      bodyText: '✅ Full amount set as due.\n\n👉 *Forward this to your client?*',
      buttons: [
        { id: 'send_to_client', title: '📤 Send to Client' },
        { id: 'done_invoice', title: '📋 Done' },
      ],
    });
    return;
  }

  // Handle advance payment amount input
  if (step === 'advance_enter_amount') {
    const amount = parseFloat(input.replace(/[₹,\s]/g, ''));
    const totalAmount = Number(session.flowData.totalAmount || session.flowData.parsedInvoice?.amount || 0);
    
    if (isNaN(amount) || amount <= 0) {
      await sendTextMessage({ to: phone, text: '⚠️ Please enter a valid amount (e.g. 5000).' });
      return;
    }
    if (amount >= totalAmount) {
      await sendTextMessage({ to: phone, text: `⚠️ Advance (${formatCurrency(amount)}) can\'t be >= total (${formatCurrency(totalAmount)}).\nEnter a smaller amount:` });
      return;
    }

    try {
      const { recordPayment } = await import('../../services/invoice.service');
      const invoiceId = session.flowData.invoiceId;
      const result = await recordPayment({ invoiceId, amount, paymentMethod: 'advance' });

      await updateSession(phone, { currentStep: 'invoice_created' });

      await sendTextMessage({
        to: phone,
        text: [
          `✅ *Advance Payment Recorded!*`,
          `━━━━━━━━━━━━━━━━━━`,
          `💵 Advance: ${formatCurrency(amount)}`,
          `📊 Balance due: *${formatCurrency(result.balanceDue)}*`,
          `📊 Status: *Partially Paid* 🟡`,
          '',
          '👉 *Forward invoice to your client?*',
        ].join('\n'),
      });

      await sendButtonMessage({
        to: phone,
        bodyText: 'What next?',
        buttons: [
          { id: 'send_to_client', title: '📤 Send to Client' },
          { id: 'done_invoice', title: '📋 Done' },
        ],
      });
    } catch (err: any) {
      logger.error('Advance payment failed', { error: err.message });
      await sendTextMessage({ to: phone, text: '❌ Failed to record advance. Please try again.' });
    }
    return;
  }

  // ── Handle edit sub-steps ──
  if (step === 'edit_choice') {
    if (input === 'edit_amount') {
      await updateSession(phone, { currentStep: 'edit_amount' });
      await sendTextMessage({ to: phone, text: `Current amount: ${formatCurrency(session.flowData.parsedInvoice?.amount || 0)}.\n\nSend the new amount:` });
      return;
    }
    if (input === 'edit_client') {
      await updateSession(phone, { currentStep: 'edit_client' });
      await sendTextMessage({ to: phone, text: 'Send the new client name:' });
      return;
    }
    if (input === 'edit_items') {
      await updateSession(phone, { currentStep: 'edit_items' });
      await sendTextMessage({ to: phone, text: 'Send the new item description:' });
      return;
    }
  }

  if (step === 'edit_amount') {
    const newAmount = parseFloat(input.replace(/[₹,]/g, ''));
    if (isNaN(newAmount) || newAmount <= 0) {
      await sendTextMessage({ to: phone, text: '⚠️ Please enter a valid amount.' });
      return;
    }
    const parsed = session.flowData.parsedInvoice as ParsedInvoice;
    parsed.amount = newAmount;
    parsed.items = [{ name: parsed.items[0]?.name || 'Service', quantity: 1, rate: newAmount }];
    await updateSession(phone, {
      currentStep: 'confirm',
      flowData: { ...session.flowData, parsedInvoice: parsed },
    });
    await sendConfirmationCard(phone, parsed, user);
    return;
  }

  if (step === 'edit_client') {
    const parsed = session.flowData.parsedInvoice as ParsedInvoice;
    parsed.clientName = input.trim();
    await updateSession(phone, {
      currentStep: 'confirm',
      flowData: { ...session.flowData, parsedInvoice: parsed },
    });
    await sendConfirmationCard(phone, parsed, user);
    return;
  }

  if (step === 'edit_items') {
    const parsed = session.flowData.parsedInvoice as ParsedInvoice;
    parsed.items = [{ name: input.trim(), quantity: 1, rate: parsed.amount }];
    await updateSession(phone, {
      currentStep: 'confirm',
      flowData: { ...session.flowData, parsedInvoice: parsed },
    });
    await sendConfirmationCard(phone, parsed, user);
    return;
  }

  // ── Handle client phone number request ──
  if (step === 'awaiting_client_phone') {
    const clientPhone = input.replace(/[\s\-\+]/g, '');
    if (clientPhone.length < 10) {
      await sendTextMessage({ to: phone, text: '⚠️ Please send a valid phone number.' });
      return;
    }
    // Ensure it starts with country code
    const normalizedPhone = clientPhone.startsWith('91') ? clientPhone : `91${clientPhone}`;
    await updateSession(phone, {
      flowData: { ...session.flowData, clientPhone: normalizedPhone },
    });
    await sendInvoiceToClient(phone, user, {
      ...session,
      flowData: { ...session.flowData, clientPhone: normalizedPhone },
    });
    return;
  }

  // ── New invoice request — parse with NLU ──
  const parsed = await parseInvoiceFromText(input);

  if (!parsed) {
    await sendTextMessage({
      to: phone,
      text: '🤔 I couldn\'t understand that. Please try like this:\n\n"Bill 5000 to Rahul for AC repair"\n\nor\n\n"Priya ko 8000 ka bill, CCTV installation"',
    });
    return;
  }

  // Save parsed data to session and show confirmation
  await updateSession(phone, {
    currentFlow: 'invoice',
    currentStep: 'confirm',
    flowData: { parsedInvoice: parsed },
  });

  await sendConfirmationCard(phone, parsed, user);
}

/**
 * Send the confirmation card with invoice preview
 */
async function sendConfirmationCard(
  phone: string,
  parsed: ParsedInvoice,
  user: User
): Promise<void> {
  const gstRate = Number(user.defaultGstRate);
  const gstAmount = Math.round((parsed.amount * gstRate) / 100 * 100) / 100;
  const total = parsed.amount + gstAmount;
  const dueDays = parsed.dueDays || user.defaultPaymentTermsDays;
  const dueDate = addDays(new Date(), dueDays);

  const itemsList = parsed.items.map((i) => i.name).join(', ');

  const preview = [
    '📄 *Invoice Preview*',
    '━━━━━━━━━━━━━━━━━━',
    `🏢 *To:* ${parsed.clientName}`,
    `💰 *Amount:* ${formatCurrency(parsed.amount)}`,
    `📝 *For:* ${itemsList}`,
    parsed.notes ? `📍 *Note:* ${parsed.notes}` : '',
    gstRate > 0 ? `🏷️ *GST (${gstRate}%):* ${formatCurrency(gstAmount)}` : '',
    `💵 *Total:* ${formatCurrency(total)}`,
    `📅 *Due:* ${formatDateShort(dueDate)}`,
  ].filter(Boolean).join('\n');

  await sendButtonMessage({
    to: phone,
    bodyText: preview,
    buttons: [
      { id: 'confirm_send', title: '✅ Send Invoice' },
      { id: 'edit_invoice', title: '✏️ Edit' },
      { id: 'cancel_invoice', title: '❌ Cancel' },
    ],
  });
}

/**
 * Confirm and create the invoice
 */
async function confirmAndSendInvoice(
  phone: string,
  user: User,
  session: SessionData
): Promise<void> {
  const parsed = session.flowData.parsedInvoice as ParsedInvoice;
  if (!parsed) {
    await sendTextMessage({ to: phone, text: '❌ No invoice data found. Please start over.' });
    await clearSession(phone);
    return;
  }

  await sendTextMessage({ to: phone, text: '⏳ Creating your invoice...' });

  try {
    const result = await createInvoice({
      userId: user.id,
      clientName: parsed.clientName,
      clientPhone: session.flowData.clientPhone,
      amount: parsed.amount,
      items: parsed.items,
      notes: parsed.notes || undefined,
      dueDays: parsed.dueDays || undefined,
    });

    // Schedule payment reminders (non-fatal — don't crash invoice creation)
    try {
      await scheduleReminders(result.id);
    } catch (reminderError: any) {
      logger.warn('Failed to schedule reminders (Redis not available?)', {
        invoiceId: result.id,
        error: reminderError?.message,
      });
    }

    // Store invoice ID in session for follow-up
    await updateSession(phone, {
      currentStep: 'invoice_created',
      flowData: {
        ...session.flowData,
        invoiceId: result.id,
        invoiceNo: result.invoiceNo,
        pdfUrl: result.pdfUrl,
        paymentLink: result.paymentLink,
      },
    });

    const freshUser = await prisma.user.findUnique({ where: { id: user.id } });

    // Build clean success message with UPI ID (not raw upi:// link)
    const upiLine = freshUser?.upiId
      ? `📲 *Pay via UPI:* ${freshUser.upiId}`
      : '';

    const successMsg = [
      `✅ *Invoice #${result.invoiceNo} Created!*`,
      '',
      `💵 Total: ${formatCurrency(result.totalAmount)}`,
      upiLine,
      result.pdfUrl ? '📎 PDF invoice attached below' : '',
      '',
      '━━━━━━━━━━━━━━━━━━',
      '👉 *Forward this to your client?*',
    ].filter(Boolean).join('\n');

    // Check if merchant has advance payment enabled
    
    if (freshUser?.enableAdvancePayment) {
      // Store total for advance amount validation
      await updateSession(phone, {
        currentStep: 'advance_choice',
        flowData: {
          ...session.flowData,
          invoiceId: result.id,
          invoiceNo: result.invoiceNo,
          totalAmount: result.totalAmount,
          pdfUrl: result.pdfUrl,
          paymentLink: result.paymentLink,
        },
      });

      await sendButtonMessage({
        to: phone,
        bodyText: successMsg + '\n\n💰 Did the client make an advance payment?',
        buttons: [
          { id: 'advance_yes', title: '💰 Record Advance' },
          { id: 'advance_no', title: '📋 Full Amount Due' },
        ],
      });
    } else {
      await sendButtonMessage({
        to: phone,
        bodyText: successMsg,
        buttons: [
          { id: 'send_to_client', title: '📤 Send to Client' },
          { id: 'done_invoice', title: '📋 Done' },
        ],
      });
    }

    // Send PDF as document attachment via WhatsApp media upload
    if (result.pdfBuffer) {
      try {
        // Upload buffer directly to WhatsApp servers (no need to re-download)
        const mediaId = await uploadMedia(result.pdfBuffer, `${result.invoiceNo}.pdf`, 'application/pdf');

        // Send using the uploaded media ID
        await sendMediaMessage({
          to: phone,
          type: 'document',
          mediaId,
          caption: `Invoice #${result.invoiceNo} - ${formatCurrency(result.totalAmount)}`,
          filename: `${result.invoiceNo}.pdf`,
        });
      } catch (pdfError: any) {
        logger.warn('Failed to send PDF to merchant', { invoiceNo: result.invoiceNo, error: pdfError?.message });
        console.error('🔴 PDF SEND ERROR:', pdfError);
      }
    }
  } catch (error: any) {
    logger.error('Invoice creation failed', { 
      phone, 
      errorMessage: error?.message,
      errorCode: error?.code,
      errorStack: error?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    console.error('🔴 FULL INVOICE ERROR:', error);
    await sendTextMessage({
      to: phone,
      text: '❌ Failed to create invoice. Please try again.',
    });
    await clearSession(phone);
  }
}

/**
 * Send the invoice to the client via WhatsApp
 */
async function sendInvoiceToClient(
  phone: string,
  user: User,
  session: SessionData
): Promise<void> {
  const { invoiceNo, pdfUrl, paymentLink, parsedInvoice } = session.flowData;
  let clientPhone = session.flowData.clientPhone;

  if (!clientPhone) {
    // Ask for client's phone number
    await updateSession(phone, { currentStep: 'awaiting_client_phone' });
    await sendTextMessage({
      to: phone,
      text: `📱 ${parsedInvoice?.clientName || 'Client'} ka WhatsApp number bhejo:`,
    });
    return;
  }

  try {
    const gstRate = Number(user.defaultGstRate);
    const gstAmount = Math.round((parsedInvoice.amount * gstRate) / 100 * 100) / 100;
    const total = parsedInvoice.amount + gstAmount;
    const description = parsedInvoice.items.map((i: any) => i.name).join(', ');
    const dueDays = parsedInvoice.dueDays || user.defaultPaymentTermsDays;
    const dueDate = addDays(new Date(), dueDays);

    // Generate UPI pay link for the WhatsApp message
    let upiPayLine = '';
    if (user.upiId) {
      const upiLink = generateUPILink({
        upiId: user.upiId,
        payeeName: user.businessName,
        amount: total,
        transactionNote: `Invoice ${invoiceNo}`,
      });
      upiPayLine = `📲 *Pay via UPI:* ${upiLink}`;
    }

    // Bank details fallback
    const bankLine = formatBankDetails({
      accountName: user.bankAccountName,
      accountNo: user.bankAccountNo,
      ifsc: user.bankIfsc,
      bankName: user.bankName,
    });

    // Send invoice message to client
    const clientMsg = [
      `🧾 *Invoice from ${user.businessName}*`,
      '',
      `Hi ${parsedInvoice.clientName},`,
      '',
      `Please find your invoice #${invoiceNo} for *${formatCurrency(total)}* (${description}).`,
      '',
      '━━━━━━━━━━━━━━━━━━',
      '*💳 Payment Details:*',
      user.upiId ? `📲 UPI ID: *${user.upiId}*` : '',
      bankLine || '',
      '━━━━━━━━━━━━━━━━━━',
      '',
      `📅 Due by: ${formatDateShort(dueDate)}`,
      '',
      `✅ *Zero convenience fee* — pay directly to our account`,
      '',
      `📎 _PDF invoice with QR code attached below_`,
      '',
      `Thank you for your business! 🙏`,
      `— ${user.businessName}`,
    ].filter(Boolean).join('\n');

    await sendTextMessage({ to: clientPhone, text: clientMsg });

    // Send PDF if available
    if (pdfUrl) {
      try {
        const pdfBuffer = await getPDFBuffer(pdfUrl);
        const mediaId = await uploadMedia(pdfBuffer, `${invoiceNo}.pdf`, 'application/pdf');

        await sendMediaMessage({
          to: clientPhone,
          type: 'document',
          mediaId,
          caption: `Invoice #${invoiceNo}`,
          filename: `${invoiceNo}.pdf`,
        });
      } catch (pdfError) {
        logger.warn('Failed to send PDF to client', { invoiceNo, error: pdfError });
      }
    }

    await sendTextMessage({
      to: phone,
      text: `✅ Invoice #${invoiceNo} sent to ${parsedInvoice.clientName}! 🎉\n\nReminders are scheduled automatically.`,
    });

    await clearSession(phone);
  } catch (error: any) {
    const errMsg = error?.message || 'Unknown error';
    logger.error('Failed to send invoice to client', { 
      phone, 
      clientPhone, 
      errorMessage: errMsg,
      errorStack: error?.stack,
    });

    // Check if it's a WhatsApp API restriction (test number can only message verified recipients)
    const isRecipientError = errMsg.includes('not a valid WhatsApp') || errMsg.includes('1013') || errMsg.includes('131030');
    const userMsg = isRecipientError
      ? `❌ Could not send to ${clientPhone}. This number may not be registered on WhatsApp, or your Meta test number can only message verified recipients.\n\n💡 Add the recipient in Meta Developer Console → WhatsApp → API Setup → "To" field.`
      : `❌ Failed to send to client: ${errMsg.substring(0, 100)}\n\nYou can share the invoice manually via the PDF.`;

    await sendTextMessage({ to: phone, text: userMsg });
    await clearSession(phone);
  }
}
