import { prisma } from '../../db/prisma';
import { PrismaClient, User, InvoiceStatus } from '@prisma/client';
import { sendTextMessage, sendButtonMessage } from '../../services/whatsapp.service';
import { markInvoicePaid, getInvoiceByNumber } from '../../services/invoice.service';
import { cancelReminders, pauseClientReminders } from '../../services/reminder.service';
import { formatCurrency } from '../../utils/currency';
import { BOT_COMMANDS } from '../../config/constants';
import { logger } from '../../utils/logger';



/**
 * Handle bot commands (non-invoice messages)
 */
export async function handleCommand(phone: string, input: string, user: User): Promise<void> {
  const text = input.toLowerCase().trim();

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
 * Handle "mark paid" command
 */
async function handleMarkPaid(phone: string, input: string, user: User): Promise<void> {
  // Try to extract invoice number or client name
  const invoiceNoMatch = input.match(/BK-\d{4}-\d{4}/i);

  if (invoiceNoMatch) {
    const invoice = await getInvoiceByNumber(invoiceNoMatch[0].toUpperCase());
    if (invoice && invoice.userId === user.id) {
      await markInvoicePaid(invoice.id, 'manual');
      await cancelReminders(invoice.id);
      await sendTextMessage({
        to: phone,
        text: `✅ Invoice #${invoice.invoiceNo} marked as paid! Reminders stopped.`,
      });
      return;
    }
  }

  // Try to find the most recent pending invoice for a mentioned client
  const pendingInvoices = await prisma.invoice.findMany({
    where: { userId: user.id, status: InvoiceStatus.PENDING },
    include: { client: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // Check if any client name is mentioned in the input
  for (const inv of pendingInvoices) {
    if (input.toLowerCase().includes(inv.client.name.toLowerCase())) {
      await markInvoicePaid(inv.id, 'manual');
      await cancelReminders(inv.id);
      await sendTextMessage({
        to: phone,
        text: `✅ Invoice #${inv.invoiceNo} (${formatCurrency(Number(inv.totalAmount))}) to ${inv.client.name} marked as paid! Reminders stopped.`,
      });
      return;
    }
  }

  // If we can't identify which invoice, show pending list
  if (pendingInvoices.length === 0) {
    await sendTextMessage({ to: phone, text: '✅ No pending invoices found!' });
  } else {
    let list = '📋 *Pending Invoices:*\n\n';
    for (const inv of pendingInvoices.slice(0, 5)) {
      list += `• #${inv.invoiceNo} — ${inv.client.name} — ${formatCurrency(Number(inv.totalAmount))}\n`;
    }
    list += '\nTo mark paid, say:\n"Mark BK-2026-0001 paid"';
    await sendTextMessage({ to: phone, text: list });
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
