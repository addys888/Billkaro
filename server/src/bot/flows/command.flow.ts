import { prisma } from '../../db/prisma';
import { PrismaClient, User, InvoiceStatus } from '@prisma/client';
import { sendTextMessage, sendButtonMessage } from '../../services/whatsapp.service';
import { recordPayment, markInvoicePaid, getInvoiceByNumber, findPendingInvoicesForClient } from '../../services/invoice.service';
import { cancelReminders, pauseClientReminders } from '../../services/reminder.service';
import { formatCurrency } from '../../utils/currency';
import { BOT_COMMANDS } from '../../config/constants';
import { updateSession, clearSession, getSession } from '../session-manager';
import { logger } from '../../utils/logger';



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
 * Handle "mark paid" command - shows interactive Full/Partial buttons
 */
async function handleMarkPaid(phone: string, input: string, user: User): Promise<void> {
  // Try to extract invoice number
  const invoiceNoMatch = input.match(/BK-[A-Z]{2}-\d{4}-\d{4}|BK-\d{4}-\d{4}/i);

  let invoice: any = null;

  if (invoiceNoMatch) {
    invoice = await getInvoiceByNumber(invoiceNoMatch[0].toUpperCase(), user.id);
  }

  // Try to find by client name if no invoice number found
  if (!invoice) {
    const pendingInvoices = await prisma.invoice.findMany({
      where: {
        userId: user.id,
        status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE] },
      },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    for (const inv of pendingInvoices) {
      if (input.toLowerCase().includes(inv.client.name.toLowerCase())) {
        invoice = inv;
        break;
      }
    }

    // If still not found, show pending list
    if (!invoice) {
      if (pendingInvoices.length === 0) {
        await sendTextMessage({ to: phone, text: '✅ No pending invoices found!' });
      } else {
        let list = '📋 *Pending Invoices:*\n\n';
        for (const inv of pendingInvoices.slice(0, 5)) {
          const paid = Number(inv.amountPaid || 0);
          const total = Number(inv.totalAmount);
          const balance = total - paid;
          const partialTag = paid > 0 ? ` (₹${paid} paid, ₹${balance} due)` : '';
          list += `• #${inv.invoiceNo} — ${inv.client.name} — ${formatCurrency(total)}${partialTag}\n`;
        }
        list += '\nTo record payment, say:\n"Rahul ne pay kar diya"';
        await sendTextMessage({ to: phone, text: list });
      }
      return;
    }
  }

  // Found the invoice — show Full/Partial payment buttons
  const totalAmount = Number(invoice.totalAmount);
  const amountPaid = Number(invoice.amountPaid || 0);
  const balanceDue = totalAmount - amountPaid;

  if (balanceDue <= 0) {
    await sendTextMessage({ to: phone, text: `✅ Invoice #${invoice.invoiceNo} is already fully paid!` });
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
      `📄 Invoice: #${invoice.invoiceNo}`,
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
          `✅ *Payment Recorded!*`,
          `━━━━━━━━━━━━━━━━━━`,
          `📄 Invoice: #${invoiceNo}`,
          `👤 Client: ${clientName}`,
          `💵 Paid: ${formatCurrency(balanceDue)}`,
          `📊 Status: *Fully Paid* ✅`,
          '',
          '🎉 All reminders stopped.',
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
          `✅ *Payment Recorded!*`,
          `━━━━━━━━━━━━━━━━━━`,
          `📄 Invoice: #${invoiceNo}`,
          `👤 Client: ${clientName}`,
          `💵 Paid now: ${formatCurrency(amount)}`,
          `📊 Status: *Fully Paid* ✅`,
          '',
          '🎉 All reminders stopped.',
        ].join('\n'),
      });
    } else {
      await sendTextMessage({
        to: phone,
        text: [
          `✅ *Partial Payment Recorded!*`,
          `━━━━━━━━━━━━━━━━━━`,
          `📄 Invoice: #${invoiceNo}`,
          `👤 Client: ${clientName}`,
          `💵 Paid now: ${formatCurrency(amount)}`,
          `💰 Total paid: ${formatCurrency(Number(result.invoice.amountPaid))}`,
          `📊 Balance due: *${formatCurrency(result.balanceDue)}*`,
          `📊 Status: *Partially Paid* 🟡`,
          '',
          '⏰ Reminders will continue for the remaining balance.',
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
      status: { in: [InvoiceStatus.PENDING, InvoiceStatus.OVERDUE] },
    },
    include: { client: true },
    orderBy: { dueDate: 'asc' },
  });

  if (pendingInvoices.length === 0) {
    await sendTextMessage({ to: phone, text: '🎉 *No pending invoices!* All payments are collected.' });
    return;
  }

  const totalPending = pendingInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0);

  let message = `📊 *Pending Summary*\n━━━━━━━━━━━━━━━━━━\n\n`;
  message += `💰 Total Pending: *${formatCurrency(totalPending)}*\n`;
  message += `📄 Invoices: ${pendingInvoices.length}\n\n`;

  for (const inv of pendingInvoices.slice(0, 8)) {
    const status = inv.status === InvoiceStatus.OVERDUE ? '🔴' : '🟡';
    message += `${status} #${inv.invoiceNo} — ${inv.client.name} — ${formatCurrency(Number(inv.totalAmount))}\n`;
  }

  if (pendingInvoices.length > 8) {
    message += `\n...and ${pendingInvoices.length - 8} more. View all at app.billkaro.in`;
  }

  await sendTextMessage({ to: phone, text: message });
}

/**
 * Handle "pause reminders" command
 */
async function handlePauseReminders(phone: string, input: string, user: User): Promise<void> {
  // Try to find client name in input
  const clients = await prisma.client.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  for (const client of clients) {
    if (input.toLowerCase().includes(client.name.toLowerCase())) {
      const count = await pauseClientReminders(user.id, client.id);
      await sendTextMessage({
        to: phone,
        text: `⏸️ Paused ${count} reminder(s) for ${client.name}.\n\nSay "resume ${client.name}" to restart.`,
      });
      return;
    }
  }

  await sendTextMessage({
    to: phone,
    text: '🤔 Which client\'s reminders should I pause?\n\nTry: "Priya ke reminders band karo"',
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
        await sendTextMessage({
          to: overdueInvoice.client.phone,
          text: `Hi ${overdueInvoice.client.name},\n\nThis is a final reminder for invoice #${overdueInvoice.invoiceNo} for ${formatCurrency(Number(overdueInvoice.totalAmount))}.\n\nKindly clear the payment at your earliest convenience.\n\n💳 Pay now: ${overdueInvoice.paymentLink}\n\n— ${user.businessName}`,
        });
        await sendTextMessage({ to: phone, text: `✅ Final reminder sent to ${overdueInvoice.client.name}.` });
      }
      break;

    case 'pause_reminders':
      await cancelReminders(overdueInvoice.id);
      await sendTextMessage({
        to: phone,
        text: `⏸️ Reminders paused for ${overdueInvoice.client.name} (#${overdueInvoice.invoiceNo}).`,
      });
      break;
  }
}

/**
 * Send help message
 */
async function sendHelpMessage(phone: string): Promise<void> {
  await sendTextMessage({
    to: phone,
    text: `📖 *BillKaro Commands*\n━━━━━━━━━━━━━━━━━━\n\n📄 *Create Invoice:*\n"Bill 5000 to Rahul for AC repair"\n\n💰 *Check Pending:*\n"kitna baaki hai" or "pending"\n\n✅ *Mark Paid:*\n"Mark BK-2026-0001 paid"\nor "Rahul ne pay kar diya"\n\n⏸️ *Pause Reminders:*\n"Priya ke reminders band karo"\n\n🔄 *Resume Reminders:*\n"resume Priya"\n\n📊 *Dashboard:*\napp.billkaro.in`,
  });
}

function matchesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}
