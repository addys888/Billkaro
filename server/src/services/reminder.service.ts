import { prisma } from '../db/prisma';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient, ReminderType, ReminderStatus, InvoiceStatus } from '@prisma/client';
import { config } from '../config';
import { REMINDER_SCHEDULE } from '../config/constants';
import { addDays, getNextBusinessDay, scheduleAt10AM, isBusinessHours, formatDateShort } from '../utils/dates';
import { formatCurrency } from '../utils/currency';
import { sendTextMessage, sendButtonMessage } from './whatsapp.service';
import { logger } from '../utils/logger';



const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create the reminder queue
const reminderQueue = new Queue('reminders', { connection });

/**
 * Schedule all reminders for a newly created invoice
 */
export async function scheduleReminders(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: true, user: true },
  });

  if (!invoice) return;

  const dueDate = new Date(invoice.dueDate);
  const reminderTypes: Array<{ type: ReminderType; daysAfterDue: number }> = [
    { type: ReminderType.DUE_DATE, daysAfterDue: REMINDER_SCHEDULE.DUE_DATE },
    { type: ReminderType.FOLLOW_UP_1, daysAfterDue: REMINDER_SCHEDULE.FOLLOW_UP_1 },
    { type: ReminderType.FOLLOW_UP_2, daysAfterDue: REMINDER_SCHEDULE.FOLLOW_UP_2 },
    { type: ReminderType.ESCALATION, daysAfterDue: REMINDER_SCHEDULE.ESCALATION },
  ];

  for (const r of reminderTypes) {
    const rawDate = addDays(dueDate, r.daysAfterDue);
    const scheduledDate = scheduleAt10AM(getNextBusinessDay(rawDate));

    // Don't schedule if the date is in the past
    if (scheduledDate <= new Date()) continue;

    const delay = scheduledDate.getTime() - Date.now();

    // Create reminder record in DB
    const reminder = await prisma.reminder.create({
      data: {
        invoiceId,
        reminderType: r.type,
        scheduledAt: scheduledDate,
        status: ReminderStatus.SCHEDULED,
      },
    });

    // Add to BullMQ queue with delay
    const job = await reminderQueue.add(
      'send-reminder',
      { reminderId: reminder.id, invoiceId },
      {
        delay,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
      }
    );

    // Save job ID for cancellation
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { bullJobId: job.id },
    });
  }

  logger.info('Reminders scheduled', { invoiceId, count: reminderTypes.length });
}

/**
 * Cancel all pending reminders for an invoice
 */
export async function cancelReminders(invoiceId: string): Promise<void> {
  const reminders = await prisma.reminder.findMany({
    where: {
      invoiceId,
      status: { in: [ReminderStatus.SCHEDULED, ReminderStatus.PAUSED] },
    },
  });

  for (const reminder of reminders) {
    // Remove from BullMQ queue
    if (reminder.bullJobId) {
      try {
        const job = await Job.fromId(reminderQueue, reminder.bullJobId);
        if (job) await job.remove();
      } catch {
        // Job may already be processed or removed
      }
    }

    // Mark as cancelled in DB
    await prisma.reminder.update({
      where: { id: reminder.id },
      data: { status: ReminderStatus.CANCELLED },
    });
  }

  logger.info('Reminders cancelled', { invoiceId, count: reminders.length });
}

/**
 * Pause reminders for a specific client's invoices
 */
export async function pauseClientReminders(userId: string, clientId: string): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: { userId, clientId, status: InvoiceStatus.PENDING },
    select: { id: true },
  });

  let count = 0;
  for (const invoice of invoices) {
    const reminders = await prisma.reminder.findMany({
      where: { invoiceId: invoice.id, status: ReminderStatus.SCHEDULED },
    });

    for (const reminder of reminders) {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: ReminderStatus.PAUSED },
      });
      count++;
    }
  }

  return count;
}

/**
 * Start the reminder worker to process scheduled reminders
 */
export function startReminderWorker(): void {
  const worker = new Worker(
    'reminders',
    async (job: Job) => {
      const { reminderId, invoiceId } = job.data;

      // Fetch fresh data
      const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
      if (!reminder || reminder.status !== ReminderStatus.SCHEDULED) {
        logger.info('Reminder skipped (cancelled/paused)', { reminderId });
        return;
      }

      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { client: true, user: true },
      });

      if (!invoice || invoice.status === InvoiceStatus.PAID) {
        logger.info('Reminder skipped (invoice paid)', { invoiceId });
        return;
      }

      // Check business hours — if outside, delay until next window
      if (!isBusinessHours()) {
        logger.info('Outside business hours, re-queuing', { reminderId });
        throw new Error('Outside business hours — will retry');
      }

      // Send the appropriate message
      await sendReminderMessage(invoice, reminder.reminderType);

      // Mark as sent
      await prisma.reminder.update({
        where: { id: reminderId },
        data: { status: ReminderStatus.SENT, sentAt: new Date() },
      });

      // If overdue, also update invoice status
      if (reminder.reminderType !== ReminderType.DUE_DATE) {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: { status: InvoiceStatus.OVERDUE },
        });
      }

      logger.info('Reminder sent', { invoiceId, type: reminder.reminderType });
    },
    { connection, concurrency: 5 }
  );

  worker.on('failed', (job, err) => {
    logger.error('Reminder job failed', { jobId: job?.id, error: err.message });
  });

  logger.info('🔔 Reminder worker started');
}

/**
 * Send the actual reminder message based on type
 */
async function sendReminderMessage(
  invoice: any,
  reminderType: ReminderType
): Promise<void> {
  const clientPhone = invoice.client.phone;
  const ownerPhone = invoice.user.phone;
  const clientName = invoice.client.name;
  const invoiceNo = invoice.invoiceNo;
  const amount = formatCurrency(Number(invoice.totalAmount));
  const dueDate = formatDateShort(new Date(invoice.dueDate));
  const paymentLink = invoice.paymentLink || '';
  const businessName = invoice.user.businessName;
  const description = invoice.description || 'Services';

  switch (reminderType) {
    case ReminderType.DUE_DATE:
      if (clientPhone) {
        await sendTextMessage({
          to: clientPhone,
          text: `Hi ${clientName} 🙏,\n\nA friendly reminder that invoice #${invoiceNo} for ${amount} (${description}) is due today.\n\n💳 Quick Pay: ${paymentLink}\n\nThank you!\n— ${businessName}`,
        });
      }
      break;

    case ReminderType.FOLLOW_UP_1:
      if (clientPhone) {
        await sendTextMessage({
          to: clientPhone,
          text: `Hi ${clientName},\n\nHope you're doing well! Just following up on invoice #${invoiceNo} for ${amount}, which was due on ${dueDate}.\n\nIf already paid, please ignore this message 🙏\n💳 Pay now: ${paymentLink}\n\n— ${businessName}`,
        });
      }
      break;

    case ReminderType.FOLLOW_UP_2:
      if (clientPhone) {
        await sendTextMessage({
          to: clientPhone,
          text: `Hi ${clientName},\n\nThis is a reminder that invoice #${invoiceNo} for ${amount} is now 7 days overdue (due: ${dueDate}).\n\nTo avoid any inconvenience, kindly clear the payment at your earliest convenience.\n\n💳 Pay now: ${paymentLink}\n📞 Questions? Call ${ownerPhone}\n\n— ${businessName}`,
        });
      }
      // Also notify owner
      await sendTextMessage({
        to: ownerPhone,
        text: `⚠️ Invoice #${invoiceNo} for ${amount} to ${clientName} is now 7 days overdue. Client has been sent a follow-up reminder.`,
      });
      break;

    case ReminderType.ESCALATION:
      // Only notify the owner — do NOT bother the client further
      await sendButtonMessage({
        to: ownerPhone,
        bodyText: `⚠️ *Overdue Alert*\n\n${clientName} has NOT paid invoice #${invoiceNo} for ${amount}. It's now 15 days overdue.\n\nWhat would you like to do?`,
        buttons: [
          { id: 'call_client', title: '📞 Call Client' },
          { id: 'send_final_reminder', title: '📤 Final Reminder' },
          { id: 'pause_reminders', title: '⏸️ Pause' },
        ],
      });
      break;
  }
}
