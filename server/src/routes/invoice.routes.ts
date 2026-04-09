import { prisma } from '../db/prisma';
import { Router, Response } from 'express';
import { PrismaClient, InvoiceStatus } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { markInvoicePaid, recordPayment } from '../services/invoice.service';
import { cancelReminders } from '../services/reminder.service';
import { sendTextMessage, sendMediaMessage } from '../services/whatsapp.service';
import { formatCurrency } from '../utils/currency';
import { config } from '../config';
import { logger } from '../utils/logger';

const router = Router();


router.use(authMiddleware);

// ── List Invoices ─────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { status, page = '1', limit = '20', search } = req.query;
    const skip = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);
    const take = parseInt(limit as string, 10);

    const where: any = { userId: req.userId };

    if (status && status !== 'all') {
      where.status = (status as string).toUpperCase();
    }

    if (search) {
      where.OR = [
        { invoiceNo: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
        { client: { name: { contains: search as string, mode: 'insensitive' } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { client: { select: { name: true, phone: true } } },
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        status: inv.status,
        clientName: inv.client.name,
        clientPhone: inv.client.phone,
        subtotal: Number(inv.subtotal),
        gstRate: Number(inv.gstRate),
        gstAmount: Number(inv.gstAmount),
        totalAmount: Number(inv.totalAmount),
        amountPaid: Number((inv as any).amountPaid || 0),
        description: inv.description,
        pdfUrl: inv.pdfUrl,
        paymentLink: inv.paymentLink,
        dueDate: inv.dueDate,
        paidAt: inv.paidAt,
        paymentMethod: inv.paymentMethod,
        createdAt: inv.createdAt,
      })),
      total,
      page: parseInt(page as string, 10),
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    logger.error('List invoices error', { error });
    res.status(500).json({ success: false, error: 'Failed to list invoices' });
  }
});

// ── Get Single Invoice ────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id as string, userId: req.userId! },
      include: { client: true },
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    res.json({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      gstRate: Number(invoice.gstRate),
      gstAmount: Number(invoice.gstAmount),
      totalAmount: Number(invoice.totalAmount),
    });
  } catch (error) {
    logger.error('Get invoice error', { error });
    res.status(500).json({ success: false, error: 'Failed to get invoice' });
  }
});

// ── Mark Invoice as Paid ──────────────────────────────────
router.patch('/:id/mark-paid', async (req: AuthRequest, res: Response) => {
  try {
    const { paymentMethod = 'manual', notes } = req.body;

    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id as string, userId: req.userId! },
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    if (invoice.status === InvoiceStatus.PAID) {
      res.status(400).json({ success: false, error: 'Invoice is already paid' });
      return;
    }

    await markInvoicePaid(invoice.id, paymentMethod, notes);
    await cancelReminders(invoice.id);

    res.json({ success: true, message: 'Invoice marked as paid' });
  } catch (error) {
    logger.error('Mark paid error', { error });
    res.status(500).json({ success: false, error: 'Failed to mark invoice as paid' });
  }
});

// ── Resend Invoice to Client ──────────────────────────────
router.post('/:id/resend', async (req: AuthRequest, res: Response) => {
  try {
    let { phone } = req.body;
    let invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id as string, userId: req.userId! },
      include: { client: true, user: true },
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    // If client has no phone but one was provided in the request, update the client
    if (!invoice.client.phone && phone) {
      const normalizedPhone = phone.startsWith('91') ? phone : `91${phone}`;
      
      try {
        await prisma.client.update({
          where: { id: invoice.client.id },
          data: { phone: normalizedPhone }
        });
      } catch (e: any) {
         if (e.code === 'P2002') {
            res.status(400).json({ success: false, error: 'This phone number is already registered to another client.' });
            return;
         }
         throw e;
      }
      
      invoice = await prisma.invoice.findFirst({
        where: { id: req.params.id as string, userId: req.userId! },
        include: { client: true, user: true },
      }) as NonNullable<typeof invoice>;
    }

    if (!invoice.client.phone) {
      res.status(400).json({ success: false, error: 'Client phone number not available' });
      return;
    }

    const upiLine = invoice.user.upiId ? `\n📲 UPI ID: ${invoice.user.upiId}` : '';
    await sendTextMessage({
      to: invoice.client.phone,
      text: `🧾 *Invoice from ${invoice.user.businessName}*\n\nHi ${invoice.client.name},\n\nKindly clear your pending invoice #${invoice.invoiceNo} for ${formatCurrency(Number(invoice.totalAmount))}.${upiLine}\n\n*Zero convenience fee* — pay directly 💰\n\nThank you! 🙏\n— ${invoice.user.businessName}`,
    });

    if (invoice.pdfUrl) {
      try {
        const absolutePdfUrl = invoice.pdfUrl.startsWith('http') 
          ? invoice.pdfUrl 
          : `${config.APP_URL}${invoice.pdfUrl.startsWith('/') ? '' : '/'}${invoice.pdfUrl}`;
          
        await sendMediaMessage({
          to: invoice.client.phone,
          type: 'document',
          mediaUrl: absolutePdfUrl,
          caption: `Invoice #${invoice.invoiceNo}`,
          filename: `${invoice.invoiceNo}.pdf`,
        });
      } catch (mediaError: any) {
        logger.warn('Failed to attach PDF during resend', { error: mediaError?.message });
      }
    }

    res.json({ success: true, message: 'Invoice resent via WhatsApp' });
  } catch (error) {
    logger.error('Resend invoice error', { error });
    res.status(500).json({ success: false, error: 'Failed to resend invoice' });
  }
});

// ── Record Partial Payment ────────────────────────────────
router.patch('/:id/record-payment', async (req: AuthRequest, res: Response) => {
  try {
    const { amount, paymentMethod = 'manual', notes } = req.body;

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      res.status(400).json({ success: false, error: 'Invalid payment amount' });
      return;
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id as string, userId: req.userId! },
    });

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    if (invoice.status === InvoiceStatus.PAID) {
      res.status(400).json({ success: false, error: 'Invoice is already fully paid' });
      return;
    }

    const result = await recordPayment({
      invoiceId: invoice.id,
      amount: Number(amount),
      paymentMethod,
      notes,
    });

    if (result.isFullyPaid) {
      await cancelReminders(invoice.id);
    }

    res.json({
      success: true,
      message: result.isFullyPaid ? 'Invoice fully paid' : 'Partial payment recorded',
      amountPaid: Number(result.invoice.amountPaid),
      balanceDue: result.balanceDue,
      isFullyPaid: result.isFullyPaid,
      status: result.invoice.status,
    });
  } catch (error: any) {
    logger.error('Record payment error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to record payment' });
  }
});

export default router;
