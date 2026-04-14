import { prisma } from '../../db/prisma';
import { User } from '@prisma/client';
import { sendTextMessage, sendButtonMessage, sendMediaMessage, uploadMedia, sendTemplateMessage } from '../../services/whatsapp.service';
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
        { id: 'edit_gst', title: '🏷️ GST Rate' },
      ],
    });
    return;
  }

  if (input === '__SEND_TO_CLIENT__') {
    await sendInvoiceToClient(phone, user, session);
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
    if (input === 'edit_gst') {
      await updateSession(phone, { currentStep: 'edit_gst' });
      await sendTextMessage({
        to: phone,
        text: '🏷️ Enter the GST rate for this invoice:\n\nValid rates: *0%*, *5%*, *12%*, *18%*, *28%*\n\n_Send just the number (e.g. 5, 12, 18):_',
      });
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

  // Handle GST rate edit
  if (step === 'edit_gst') {
    const rate = parseFloat(input.replace(/[%]/g, '').trim());
    const validRates = [0, 5, 12, 18, 28];
    if (isNaN(rate) || !validRates.includes(rate)) {
      await sendTextMessage({
        to: phone,
        text: '⚠️ Please enter a valid GST rate: *0*, *5*, *12*, *18*, or *28*',
      });
      return;
    }
    const parsed = session.flowData.parsedInvoice as ParsedInvoice;
    parsed.gstRate = rate;
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
  const hasGstin = !!user.gstin;

  // GST: no GSTIN = always 0%, with GSTIN = use parsed or default rate
  let gstRate: number;
  if (!hasGstin) {
    gstRate = 0;
  } else {
    gstRate = parsed.gstRate != null ? parsed.gstRate : Number(user.defaultGstRate);
  }
  const gstAmount = Math.round((parsed.amount * gstRate) / 100 * 100) / 100;
  const total = parsed.amount + gstAmount;
  const dueDays = parsed.dueDays || user.defaultPaymentTermsDays;
  const dueDate = addDays(new Date(), dueDays);

  const itemsList = parsed.items.map((i) => i.name).join(', ');

  const previewLines = [
    '📋 *Invoice Preview*',
    '',
    `👤 Client: *${parsed.clientName}*`,
    `💵 Amount: ${formatCurrency(parsed.amount)}`,
    `📦 Items: ${itemsList}`,
    parsed.notes ? `📝 Note: ${parsed.notes}` : '',
  ];

  if (hasGstin) {
    const gstLabel = parsed.gstRate != null ? '(custom)' : '(default)';
    previewLines.push(`🏷️ GST (${gstRate}%) ${gstLabel}: ${gstRate > 0 ? formatCurrency(gstAmount) : 'Nil'}`);
  }

  previewLines.push(
    `💰 Total: *${formatCurrency(total)}*`,
    `📅 Due: ${formatDateShort(dueDate)}`,
    '',
    hasGstin ? 'Look good? _Tap Edit to change GST rate._' : 'Look good?',
  );

  const preview = previewLines.filter(Boolean).join('\n');

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
      gstRate: parsed.gstRate != null ? parsed.gstRate : undefined,
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
      '💡 Send this to your client — they can pay and share UTR/screenshot for auto-verification.',
    ].filter(Boolean).join('\n');

    await sendButtonMessage({
      to: phone,
      bodyText: successMsg,
      buttons: [
        { id: 'send_to_client', title: '📤 Send to Client' },
        { id: 'done_invoice', title: '📋 Done' },
      ],
    });

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
  const { invoiceNo, invoiceId, pdfUrl, parsedInvoice } = session.flowData;
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
    // ── 1. Fetch the actual invoice from DB ──
    const invoice = await prisma.invoice.findFirst({
      where: { invoiceNo },
      include: { client: true },
    });

    if (!invoice) {
      await sendTextMessage({ to: phone, text: '❌ Invoice not found. Please try again.' });
      await clearSession(phone);
      return;
    }

    const totalAmount = Number(invoice.totalAmount);
    const amountPaid = Number(invoice.amountPaid || 0);
    const balanceDue = totalAmount - amountPaid;
    const description = invoice.description || parsedInvoice.items?.map((i: any) => i.name).join(', ') || 'Services';
    const dueDate = new Date(invoice.dueDate);

    // ── 2. Save client phone to DB if not already set ──
    if (invoice.client && !invoice.client.phone) {
      try {
        await prisma.client.update({
          where: { id: invoice.clientId },
          data: { phone: clientPhone },
        });
        logger.info('Client phone saved', { clientId: invoice.clientId, phone: clientPhone });
      } catch (phoneErr: any) {
        // May fail if phone already exists for another client (unique constraint)
        logger.warn('Could not save client phone', { error: phoneErr.message });
      }
    }

    // ── 3. Mark invoice as sent to client ──
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { sentToClient: true },
    });

    // ── 4. Build UPI pay link with BALANCE DUE (not total) ──
    const payAmount = balanceDue > 0 ? balanceDue : totalAmount;
    let upiPayLink = '';
    if (user.upiId && payAmount > 0) {
      upiPayLink = generateUPILink({
        upiId: user.upiId,
        payeeName: user.businessName,
        amount: payAmount,
        transactionNote: `Invoice ${invoiceNo}`,
      });
    }

    // ── 5. Build partial payment info ──
    let partialPayLine = '';
    if (amountPaid > 0 && balanceDue > 0) {
      partialPayLine = `\n✅ Advance received: ${formatCurrency(amountPaid)}\n💰 *Balance due: ${formatCurrency(balanceDue)}*\n`;
    } else if (amountPaid > 0 && balanceDue <= 0) {
      partialPayLine = `\n✅ *Fully Paid — Thank You!* 🎉\n`;
    }

    // Bank details fallback
    const bankLine = formatBankDetails({
      accountName: user.bankAccountName,
      accountNo: user.bankAccountNo,
      ifsc: user.bankIfsc,
      bankName: user.bankName,
    });

    // ── 6. Build client message ──
    const msgParts: string[] = [
      `🧾 *Invoice from ${user.businessName}*`,
      `Hi ${parsedInvoice.clientName},`,
      '',
      `Please find your invoice *#${invoiceNo}* for *${formatCurrency(totalAmount)}* (${description}).`,
    ];

    if (partialPayLine) {
      msgParts.push(partialPayLine);
    }

    // Payment section
    msgParts.push('━━━━━━━━━━━━━━━━━━');

    if (balanceDue > 0 && upiPayLink) {
      msgParts.push(
        `💰 *Pay ${formatCurrency(payAmount)}*`,
        '',
        `📲 UPI ID: *${user.upiId}*`,
      );
      if (bankLine) msgParts.push(bankLine);
      msgParts.push(
        '',
        `👇 _Tap below to pay instantly:_`,
        upiPayLink,
      );
    } else {
      msgParts.push('*💳 Payment Details:*');
      if (user.upiId) msgParts.push(`📲 UPI ID: *${user.upiId}*`);
      if (bankLine) msgParts.push(bankLine);
    }

    msgParts.push(
      '━━━━━━━━━━━━━━━━━━',
      '',
      `📅 Due by: ${formatDateShort(dueDate)}`,
      `✅ *Zero convenience fee* — pay directly`,
      '',
      `📎 _PDF invoice with QR code attached below_`,
      '',
    );

    if (balanceDue > 0) {
      msgParts.push(
        `After payment, please reply with your *UTR/Transaction ID* for confirmation. 🙏`,
      );
    } else {
      msgParts.push(`Thank you for your payment! 🙏`);
    }
    msgParts.push(`— ${user.businessName}`);

    const clientMsg = msgParts.filter(Boolean).join('\n');

    // With Meta test numbers, ONLY template messages get delivered to new clients.
    // Strategy: try invoice_with_pdf (includes PDF) → invoice_notification → hello_world → freeform
    let templateSent = false;
    let pdfSentViaTemplate = false;

    // Upload PDF first if available (needed for template header)
    let pdfMediaId: string | null = null;
    if (pdfUrl) {
      try {
        const pdfBuffer = await getPDFBuffer(pdfUrl);
        pdfMediaId = await uploadMedia(pdfBuffer, `${invoiceNo}.pdf`, 'application/pdf');
      } catch (pdfErr: any) {
        logger.warn('Failed to upload PDF for template', { error: pdfErr?.message });
      }
    }

    // Try invoice_with_pdf template (includes PDF as document header)
    if (pdfMediaId) {
      try {
        await sendTemplateMessage({
          to: clientPhone,
          templateName: 'invoice_with_pdf',
          languageCode: 'en',
          components: [
            {
              type: 'header',
              parameters: [
                { type: 'document', document: { id: pdfMediaId, filename: `${invoiceNo}.pdf` } },
              ],
            },
            {
              type: 'body',
              parameters: [
                { type: 'text', text: parsedInvoice.clientName },
                { type: 'text', text: user.businessName },
                { type: 'text', text: invoiceNo },
                { type: 'text', text: formatCurrency(totalAmount) },
                { type: 'text', text: formatDateShort(dueDate) },
                { type: 'text', text: user.upiId || 'N/A' },
              ],
            },
          ],
        });
        templateSent = true;
        pdfSentViaTemplate = true;
        logger.info('Invoice sent via invoice_with_pdf template', { invoiceNo, clientPhone });
      } catch (pdfTemplateErr: any) {
        logger.warn('invoice_with_pdf template failed', { error: pdfTemplateErr?.message });
      }
    }

    // Fallback: try invoice_notification template (no PDF)
    if (!templateSent) {
      try {
        await sendTemplateMessage({
          to: clientPhone,
          templateName: 'invoice_notification',
          languageCode: 'en',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: parsedInvoice.clientName },
                { type: 'text', text: user.businessName },
                { type: 'text', text: invoiceNo },
                { type: 'text', text: formatCurrency(totalAmount) },
                { type: 'text', text: formatDateShort(dueDate) },
                { type: 'text', text: user.upiId || 'N/A' },
              ],
            },
          ],
        });
        templateSent = true;
        logger.info('Invoice sent via invoice_notification template', { invoiceNo, clientPhone });
      } catch (templateErr: any) {
        logger.warn('invoice_notification template failed, trying hello_world', { error: templateErr?.message });

        // Fallback: hello_world
        try {
          await sendTemplateMessage({
            to: clientPhone,
            templateName: 'hello_world',
            languageCode: 'en_US',
          });
          templateSent = true;
        } catch (helloErr: any) {
          logger.warn('hello_world template also failed', { error: helloErr?.message });
        }
      }
    }

    // Only send freeform text + separate PDF if NO template was delivered
    // (avoids duplicate messages when template already includes the invoice details)
    if (!templateSent) {
      await sendTextMessage({ to: clientPhone, text: clientMsg });

      // Send PDF separately
      if (pdfMediaId) {
        try {
          await sendMediaMessage({
            to: clientPhone,
            type: 'document',
            mediaId: pdfMediaId,
            caption: `Invoice #${invoiceNo}`,
            filename: `${invoiceNo}.pdf`,
          });
        } catch (pdfError) {
          logger.warn('Failed to send PDF to client', { invoiceNo, error: pdfError });
        }
      }
    }

    // ── 7. Confirm to merchant ──
    const confirmMsg = [
      `✅ Invoice *#${invoiceNo}* sent to ${parsedInvoice.clientName}! 🎉`,
      '',
      `📱 Sent to: ${clientPhone}`,
      `💵 Total Due: ${formatCurrency(balanceDue)}`,
      '⏰ Reminders are scheduled automatically.',
      '',
      '💡 When client pays & shares UTR/screenshot, payment will be verified automatically.',
      '💡 Send another invoice anytime.',
    ].filter(Boolean).join('\n');

    await sendTextMessage({ to: phone, text: confirmMsg });
    await clearSession(phone);
  } catch (error: any) {
    const errMsg = error?.message || 'Unknown error';
    logger.error('Failed to send invoice to client', { 
      phone, 
      clientPhone, 
      errorMessage: errMsg,
      errorStack: error?.stack,
    });

    // Parse the actual WhatsApp API error for better diagnostics
    let apiErrorCode = '';
    let apiErrorDetail = '';
    try {
      // Our WhatsApp service throws errors like: "WhatsApp API error (400): {\"error\":{...}}"
      const jsonMatch = errMsg.match(/\{.*\}/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        apiErrorCode = parsed?.error?.code?.toString() || '';
        apiErrorDetail = parsed?.error?.error_data?.details || parsed?.error?.message || '';
      }
    } catch (_) { /* ignore parse errors */ }

    // Build diagnostic message
    const isRecipientError = errMsg.includes('not a valid WhatsApp') || errMsg.includes('1013') || errMsg.includes('131030') || apiErrorCode === '131030';
    const isAuthError = errMsg.includes('401') || errMsg.includes('190') || apiErrorCode === '190';
    
    let userMsg: string;
    if (isAuthError) {
      userMsg = `❌ WhatsApp token expired! Please generate a new access token in Meta Developer Console and update the server.\n\n🔧 Error: Token invalid or expired.`;
    } else if (isRecipientError) {
      userMsg = `❌ Could not send to ${clientPhone}. This number may not be registered on WhatsApp, or your Meta test number can only message verified recipients.\n\n💡 Add the recipient in Meta Developer Console → WhatsApp → API Setup → "To" field.`;
    } else {
      userMsg = `❌ Failed to send invoice to client.\n\n🔧 Error: ${apiErrorDetail || errMsg.substring(0, 150)}\n\nYou can share the invoice manually via the PDF.`;
    }

    await sendTextMessage({ to: phone, text: userMsg });
    await clearSession(phone);
  }
}
