import { prisma } from '../../db/prisma';
import { PrismaClient, User, InvoiceStatus } from '@prisma/client';
import { sendTextMessage, sendButtonMessage } from '../../services/whatsapp.service';
import { recordPayment, markInvoicePaid, getInvoiceByNumber, findPendingInvoicesForClient } from '../../services/invoice.service';
import { cancelReminders, pauseClientReminders } from '../../services/reminder.service';
import { formatCurrency } from '../../utils/currency';
import { BOT_COMMANDS } from '../../config/constants';
import { updateSession, clearSession, getSession } from '../session-manager';
import { logger } from '../../utils/logger';

// ── Invoice number pattern ────────────────────────────────
// Matches: BK-MP-2604-0004, BK-2604-0004, etc.
const INVOICE_NO_REGEX = /BK-(?:[A-Z]{2}-)?(\d{4})-(\d{4})/i;

/**
 * Extract invoice number from text — tries exact match first, then short code (last 4 digits)
 */
function extractInvoiceRef(text: string): { invoiceNo: string | null; shortCode: string | null } {
  const fullMatch = text.match(INVOICE_NO_REGEX);
  if (fullMatch) {
    return { invoiceNo: fullMatch[0].toUpperCase(), shortCode: null };
  }
  // Short code: just 4 digits like "0004" or "#0004" or "4"
  const shortMatch = text.match(/(?:#|no\.?\s*)?(\d{1,4})\b/i);
  if (shortMatch) {
    return { invoiceNo: null, shortCode: shortMatch[1].padStart(4, '0') };
  }
  return { invoiceNo: null, shortCode: null };
}

/**
 * Find invoice by full number or short code (last 4 digits)
 */
async function findInvoice(userId: string, text: string): Promise<any> {
  const { invoiceNo, shortCode } = extractInvoiceRef(text);

  // 1. Try exact match
  if (invoiceNo) {
    const invoice = await getInvoiceByNumber(invoiceNo, userId);
    if (invoice) return invoice;
  }

  // 2. Try short code (last 4 digits) — search recent invoices
  if (shortCode) {
    const invoice = await prisma.invoice.findFirst({
      where: {
        userId,
        invoiceNo: { endsWith: shortCode },
      },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });
    if (invoice) return invoice;
  }

  // 3. Try client name match as fallback
  const pendingInvoices = await prisma.invoice.findMany({
    where: {
      userId,
      status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
    },
    include: { client: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  for (const inv of pendingInvoices) {
    if (text.toLowerCase().includes(inv.client.name.toLowerCase())) {
      return inv;
    }
  }

  return null;
}

/**
 * Handle bot commands (non-invoice messages)
 */
export async function handleCommand(phone: string, input: string, user: User): Promise<void> {
  const text = input.toLowerCase().trim();

  // ── Check if we're in a payment recording flow ──
  const session = await getSession(phone);
  if (session?.currentFlow === 'record_payment') {
    await handlePaymentAmountInput(phone, input, user, session);
    return;
  }

  // ── Help ──
  if (matchesAny(text, BOT_COMMANDS.HELP)) {
    await sendHelpMessage(phone);
    return;
  }

  // ── Mark Paid ──
  if (matchesAny(text, BOT_COMMANDS.MARK_PAID)) {
    await handleMarkPaid(phone, input, user);
    return;
  }

  // ── List Pending ──
  if (matchesAny(text, BOT_COMMANDS.LIST_PENDING)) {
    await handleListPending(phone, user);
    return;
  }

  // ── Pause Reminders ──
  if (matchesAny(text, BOT_COMMANDS.PAUSE_REMINDERS)) {
    await handlePauseReminders(phone, input, user);
    return;
  }

  // ── Button actions from escalation ──
  if (text === 'call_client' || text === 'send_final_reminder' || text === 'pause_reminders') {
    await handleEscalationAction(phone, text, user);
    return;
  }

  // ── Fallback ──
  await sendHelpMessage(phone);
}

/**
 * Handle "mark paid" command — invoice-number-first approach
 */
async function handleMarkPaid(phone: string, input: string, user: User): Promise<void> {
  const invoice = await findInvoice(user.id, input);

  if (!invoice) {
    // No match — show pending list with invoice numbers
    const pendingInvoices = await prisma.invoice.findMany({
      where: {
        userId: user.id,
        status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
      },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    if (pendingInvoices.length === 0) {
      await sendTextMessage({ to: phone, text: '✅ No pending invoices found!' });
      return;
    }

    let list = '📋 *Pending Invoices:*\n\n';
    for (const inv of pendingInvoices) {
      const paid = Number(inv.amountPaid || 0);
      const total = Number(inv.totalAmount);
      const balance = total - paid;
      const status = inv.status === InvoiceStatus.OVERDUE ? '🔴' :
                     inv.status === InvoiceStatus.PARTIALLY_PAID ? '🟡' : '⚪';
      const partialTag = paid > 0 ? ` (₹${paid} paid)` : '';
      list += `${status} *#${inv.invoiceNo}*\n   ${inv.client.name} — ${formatCurrency(balance)} due${partialTag}\n\n`;
    }
    list += '━━━━━━━━━━━━━━━━━━\n';
    list += '💡 To mark paid, send:\n';
    list += '_\"Paid #0004\"_ or _\"Paid BK-MP-2604-0004\"_';
    await sendTextMessage({ to: phone, text: list });
    return;
  }

  // Found the invoice
  const totalAmount = Number(invoice.totalAmount);
  const amountPaid = Number(invoice.amountPaid || 0);
  const balanceDue = totalAmount - amountPaid;

  if (balanceDue <= 0) {
    await sendTextMessage({ to: phone, text: `✅ Invoice *#${invoice.invoiceNo}* is already fully paid!` });
    return;
  }

  // Store invoice in session for the payment flow
  await updateSession(phone, {
    currentFlow: 'record_payment',
    currentStep: 'choose_type',
    flowData: {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      clientName: invoice.client?.name || 'Client',
      totalAmount,
      amountPaid,
      balanceDue,
    },
  });

  const paidLine = amountPaid > 0 ? `\n💵 Already paid: ${formatCurrency(amountPaid)}` : '';

  await sendButtonMessage({
    to: phone,
    bodyText: [
      `💰 *Record Payment*`,
      `━━━━━━━━━━━━━━━━━━`,
      `📄 Invoice: *#${invoice.invoiceNo}*`,
      `👤 Client: ${invoice.client?.name}`,
      `🏷️ Total: ${formatCurrency(totalAmount)}`,
      paidLine,
      `💵 Balance Due: *${formatCurrency(balanceDue)}*`,
      '',
      '👇 How much did they pay?',
    ].filter(Boolean).join('\n'),
    buttons: [
      { id: 'pay_full', title: `✅ Full (${formatCurrency(balanceDue)})` },
      { id: 'pay_partial', title: '💰 Partial Payment' },
    ],
  });
}

/**
 * Handle Full/Partial payment button responses
 */
export async function handlePaymentButton(phone: string, buttonId: string, user: User): Promise<void> {
  const session = await getSession(phone);
  if (!session || session.currentFlow !== 'record_payment') {
    await sendTextMessage({ to: phone, text: '⚠️ No payment in progress.' });
    return;
  }

  const { invoiceId, invoiceNo, clientName, balanceDue } = session.flowData;

  if (buttonId === 'pay_full') {
    // Record full remaining payment
    try {
      const result = await recordPayment({
        invoiceId,
        amount: balanceDue,
        paymentMethod: 'manual',
      });

      await cancelReminders(invoiceId);
      await clearSession(phone);

      await sendTextMessage({
        to: phone,
        text: [
          `✅ *Payment Recorded — Thank You!* 🎉`,
          `━━━━━━━━━━━━━━━━━━`,
          `📄 Invoice: *#${invoiceNo}*`,
          `👤 Client: ${clientName}`,
          `💵 Paid: ${formatCurrency(balanceDue)}`,
          `📊 Status: *Fully Paid* ✅`,
          '',
          '🔔 All reminders stopped automatically.',
          '',
          '🙏 Payment collected successfully!',
          '💡 Send another invoice anytime.',
        ].join('\n'),
      });
    } catch (err: any) {
      logger.error('Full payment failed', { error: err.message });
      await clearSession(phone);
      await sendTextMessage({ to: phone, text: '❌ Failed to record payment. Please try again.' });
    }
  } else if (buttonId === 'pay_partial') {
    // Ask for the amount
    await updateSession(phone, {
      currentStep: 'enter_amount',
    });
    await sendTextMessage({
      to: phone,
      text: `💰 How much did ${clientName} pay?\n\nBalance due: ${formatCurrency(balanceDue)}\n\n_Send the amount (e.g. 5000):_`,
    });
  }
}

/**
 * Handle partial payment amount input
 */
async function handlePaymentAmountInput(
  phone: string,
  input: string,
  user: User,
  session: any
): Promise<void> {
  if (session.currentStep !== 'enter_amount') {
    await clearSession(phone);
    return;
  }

  const { invoiceId, invoiceNo, clientName, totalAmount, balanceDue } = session.flowData;

  // Parse amount from input
  const amount = parseFloat(input.replace(/[₹,\s]/g, ''));
  if (isNaN(amount) || amount <= 0) {
    await sendTextMessage({ to: phone, text: '⚠️ Please enter a valid amount (e.g. 5000).' });
    return;
  }

  if (amount > balanceDue) {
    await sendTextMessage({
      to: phone,
      text: `⚠️ Amount (${formatCurrency(amount)}) exceeds balance due (${formatCurrency(balanceDue)}).\n\nPlease enter an amount up to ${formatCurrency(balanceDue)}.`,
    });
    return;
  }

  try {
    const result = await recordPayment({
      invoiceId,
      amount,
      paymentMethod: 'manual',
    });

    await clearSession(phone);

    if (result.isFullyPaid) {
      await cancelReminders(invoiceId);
      await sendTextMessage({
        to: phone,
        text: [
          `✅ *Payment Recorded — Thank You!* 🎉`,
          `━━━━━━━━━━━━━━━━━━`,
          `📄 Invoice: *#${invoiceNo}*`,
          `👤 Client: ${clientName}`,
          `💵 Paid now: ${formatCurrency(amount)}`,
          `📊 Status: *Fully Paid* ✅`,
          '',
          '🔔 All reminders stopped automatically.',
          '',
          '🙏 Payment collected successfully!',
          '💡 Send another invoice anytime.',
        ].join('\n'),
      });
    } else {
      await sendTextMessage({
        to: phone,
        text: [
          `✅ *Partial Payment Recorded — Thank You!* 👍`,
          `━━━━━━━━━━━━━━━━━━`,
          `📄 Invoice: *#${invoiceNo}*`,
          `👤 Client: ${clientName}`,
          `💵 Paid now: ${formatCurrency(amount)}`,
          `💰 Total paid: ${formatCurrency(Number(result.invoice.amountPaid))}`,
          `📊 Balance due: *${formatCurrency(result.balanceDue)}*`,
          `📊 Status: *Partially Paid* 🟡`,
          '',
          '⏰ Reminders will continue for ₹' + result.balanceDue.toLocaleString('en-IN') + '.',
          '💡 Say _"Paid #' + invoiceNo.split('-').pop() + '"_ when balance is cleared.',
        ].join('\n'),
      });
    }
  } catch (err: any) {
    logger.error('Partial payment failed', { error: err.message });
    await clearSession(phone);
    await sendTextMessage({ to: phone, text: '❌ Failed to record payment. Please try again.' });
  }
}

/**
 * Handle "list pending" command
 */
async function handleListPending(phone: string, user: User): Promise<void> {
  const pendingInvoices = await prisma.invoice.findMany({
    where: {
      userId: user.id,
      status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
    },
    include: { client: true },
    orderBy: { dueDate: 'asc' },
  });

  if (pendingInvoices.length === 0) {
    await sendTextMessage({ to: phone, text: '🎉 *No pending invoices!* All payments are collected.' });
    return;
  }

  const totalPending = pendingInvoices.reduce((sum, inv) => {
    const balance = Number(inv.totalAmount) - Number(inv.amountPaid || 0);
    return sum + balance;
  }, 0);

  let message = `📊 *Pending Summary*\n━━━━━━━━━━━━━━━━━━\n\n`;
  message += `💰 Total Pending: *${formatCurrency(totalPending)}*\n`;
  message += `📄 Invoices: ${pendingInvoices.length}\n\n`;

  for (const inv of pendingInvoices.slice(0, 8)) {
    const paid = Number(inv.amountPaid || 0);
    const total = Number(inv.totalAmount);
    const balance = total - paid;
    const status = inv.status === InvoiceStatus.OVERDUE ? '🔴' :
                   inv.status === InvoiceStatus.PARTIALLY_PAID ? '🟡' : '⚪';
    const partialTag = paid > 0 ? ` (₹${paid} paid)` : '';
    message += `${status} *#${inv.invoiceNo}*\n   ${inv.client.name} — ${formatCurrency(balance)} due${partialTag}\n\n`;
  }

  if (pendingInvoices.length > 8) {
    message += `...and ${pendingInvoices.length - 8} more. View all at app.billkaro.in\n`;
  }

  message += '━━━━━━━━━━━━━━━━━━\n';
  message += '💡 _\"Paid #0004\"_ to record payment\n';
  message += '💡 _\"Pause #0004\"_ to pause reminders';

  await sendTextMessage({ to: phone, text: message });
}

/**
 * Handle "pause reminders" — invoice-number-first, client name fallback
 */
async function handlePauseReminders(phone: string, input: string, user: User): Promise<void> {
  // 1. Try to find by invoice number
  const invoice = await findInvoice(user.id, input);

  if (invoice) {
    // Pause reminders for this specific invoice
    const { cancelReminders: cancelRem } = await import('../../services/reminder.service');
    const reminders = await prisma.reminder.findMany({
      where: {
        invoiceId: invoice.id,
        status: 'SCHEDULED',
      },
    });

    let count = 0;
    for (const reminder of reminders) {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'PAUSED' },
      });
      count++;
    }

    await sendTextMessage({
      to: phone,
      text: `⏸️ Paused ${count} reminder(s) for invoice *#${invoice.invoiceNo}* (${invoice.client?.name || 'Client'}).\n\n💡 Say _\"Resume #${invoice.invoiceNo.split('-').pop()}\"_ to restart.`,
    });
    return;
  }

  // 2. No match — show pending list
  await sendTextMessage({
    to: phone,
    text: '🤔 Which invoice should I pause reminders for?\n\n💡 Send:\n_\"Pause #0004\"_ or _\"Pause BK-MP-2604-0004\"_\n\nSay _\"pending\"_ to see your invoice list.',
  });
}

/**
 * Handle escalation button actions
 */
async function handleEscalationAction(phone: string, action: string, user: User): Promise<void> {
  // Get the most recent overdue invoice
  const overdueInvoice = await prisma.invoice.findFirst({
    where: { userId: user.id, status: InvoiceStatus.OVERDUE },
    include: { client: true },
    orderBy: { dueDate: 'asc' },
  });

  if (!overdueInvoice) {
    await sendTextMessage({ to: phone, text: 'No overdue invoices found.' });
    return;
  }

  switch (action) {
    case 'call_client':
      await sendTextMessage({
        to: phone,
        text: `📞 Call ${overdueInvoice.client.name}: ${overdueInvoice.client.phone || 'No phone number saved'}`,
      });
      break;

    case 'send_final_reminder':
      if (overdueInvoice.client.phone) {
        const balance = Number(overdueInvoice.totalAmount) - Number(overdueInvoice.amountPaid || 0);
        await sendTextMessage({
          to: overdueInvoice.client.phone,
          text: `Hi ${overdueInvoice.client.name},\n\nThis is a final reminder for invoice #${overdueInvoice.invoiceNo} for ${formatCurrency(balance)}.\n\nKindly clear the payment at your earliest convenience.\n\n💳 Pay now: ${overdueInvoice.paymentLink}\n\n— ${user.businessName}`,
        });
        await sendTextMessage({ to: phone, text: `✅ Final reminder sent to ${overdueInvoice.client.name}.` });
      }
      break;

    case 'pause_reminders':
      await cancelReminders(overdueInvoice.id);
      await sendTextMessage({
        to: phone,
        text: `⏸️ Reminders paused for *#${overdueInvoice.invoiceNo}* (${overdueInvoice.client.name}).`,
      });
      break;
  }
}

/**
 * Send help message — updated with invoice-number-based commands
 */
async function sendHelpMessage(phone: string): Promise<void> {
  await sendTextMessage({
    to: phone,
    text: [
      `📖 *BillKaro Commands*`,
      `━━━━━━━━━━━━━━━━━━`,
      ``,
      `📄 *Create Invoice:*`,
      `"Bill 5000 to Rahul for AC repair"`,
      ``,
      `💰 *Check Pending:*`,
      `"pending" or "kitna baaki hai"`,
      ``,
      `✅ *Record Payment:*`,
      `"Paid #0004" or "Paid BK-MP-2604-0004"`,
      ``,
      `⏸️ *Pause Reminders:*`,
      `"Pause #0004"`,
      ``,
      `🔄 *Resume Reminders:*`,
      `"Resume #0004"`,
      ``,
      `📊 *Dashboard:*`,
      `app.billkaro.in`,
    ].join('\n'),
  });
}

function matchesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}
