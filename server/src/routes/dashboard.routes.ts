import { prisma } from '../db/prisma';
import { Router, Response } from 'express';
import { PrismaClient, InvoiceStatus } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../utils/logger';

const router = Router();


router.use(authMiddleware);

// ── Dashboard Overview ────────────────────────────────────
router.get('/overview', async (req: AuthRequest, res: Response) => {
  try {
    const period = (req.query.period as string) || 'month';
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'quarter':
        startDate = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        userId: req.userId,
        createdAt: { gte: startDate },
      },
      include: {
        client: { select: { name: true, phone: true } },
      },
    });

    let totalInvoiced = 0;
    let totalCollected = 0;
    let totalPending = 0;
    let totalOverdue = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;
    let totalDaysToPay = 0;
    let paidWithDays = 0;
    const overdueInvoices: any[] = [];

    for (const inv of invoices) {
      const amount = Number(inv.totalAmount);
      const amountPaid = Number(inv.amountPaid || 0);
      const balanceDue = amount - amountPaid;
      totalInvoiced += amount;

      if (inv.status === InvoiceStatus.PAID) {
        totalCollected += amount;
        paidCount++;
        if (inv.paidAt) {
          const days = Math.floor(
            (inv.paidAt.getTime() - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24)
          );
          totalDaysToPay += days;
          paidWithDays++;
        }
      } else if (inv.status === 'PARTIALLY_PAID') {
        totalCollected += amountPaid;
        // Partially paid: check if also overdue
        if (new Date(inv.dueDate) < now) {
          totalOverdue += balanceDue;
          overdueCount++;
          overdueInvoices.push({
            id: inv.id,
            invoiceNo: inv.invoiceNo,
            clientName: inv.client.name,
            clientPhone: inv.client.phone || null,
            description: inv.description || '',
            totalAmount: amount,
            amountPaid,
            daysOverdue: Math.floor(
              (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
            ),
          });
        } else {
          totalPending += balanceDue;
          pendingCount++;
        }
      } else if (inv.status === InvoiceStatus.OVERDUE) {
        totalOverdue += balanceDue;
        overdueCount++;
        overdueInvoices.push({
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          clientName: inv.client.name,
          totalAmount: amount,
          amountPaid,
          daysOverdue: Math.floor(
            (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
          ),
        });
      } else if (inv.status === InvoiceStatus.PENDING) {
        // Check if actually overdue (date passed but status not updated)
        if (new Date(inv.dueDate) < now) {
          totalOverdue += balanceDue;
          overdueCount++;
          overdueInvoices.push({
            id: inv.id,
            invoiceNo: inv.invoiceNo,
            clientName: inv.client.name,
            totalAmount: amount,
            amountPaid,
            daysOverdue: Math.floor(
              (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
            ),
          });
        } else {
          totalPending += balanceDue;
          pendingCount++;
        }
      }
    }

    const collectionRate = totalInvoiced > 0
      ? Math.round((totalCollected / totalInvoiced) * 10000) / 100
      : 0;

    const avgDaysToPay = paidWithDays > 0
      ? Math.round((totalDaysToPay / paidWithDays) * 10) / 10
      : 0;

    // Sort overdue by days overdue (most overdue first)
    overdueInvoices.sort((a, b) => b.daysOverdue - a.daysOverdue);

    res.json({
      totalInvoiced,
      totalCollected,
      totalPending: totalInvoiced - totalCollected, // Simple: everything not yet collected
      totalOverdue,
      invoiceCount: invoices.length,
      paidCount,
      pendingCount: pendingCount + overdueCount, // All unpaid invoices
      overdueCount,
      collectionRate,
      avgDaysToPay,
      overdueInvoices, // All overdue — no limit
    });
  } catch (error) {
    logger.error('Dashboard overview error', { error });
    res.status(500).json({ success: false, error: 'Failed to get overview' });
  }
});

// ── Dashboard Trends ──────────────────────────────────────
router.get('/trends', async (req: AuthRequest, res: Response) => {
  try {
    const monthCount = parseInt((req.query.months as string) || '6', 10);
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - monthCount + 1, 1);

    // Single query for all months instead of N+1
    const invoices = await prisma.invoice.findMany({
      where: {
        userId: req.userId,
        createdAt: { gte: startDate },
      },
      select: {
        totalAmount: true,
        amountPaid: true,
        status: true,
        createdAt: true,
      },
    });

    // Group by month locally
    const monthMap = new Map<string, { invoiced: number; collected: number }>();

    // Pre-fill all months so there are no gaps
    for (let i = monthCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
      monthMap.set(key, { invoiced: 0, collected: 0 });
    }

    for (const inv of invoices) {
      const d = new Date(inv.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
      const bucket = monthMap.get(key);
      if (!bucket) continue;

      bucket.invoiced += Number(inv.totalAmount);

      if (inv.status === InvoiceStatus.PAID) {
        bucket.collected += Number(inv.totalAmount);
      } else if (inv.status === 'PARTIALLY_PAID') {
        // Include partial payments in collected amount
        bucket.collected += Number(inv.amountPaid || 0);
      }
    }

    // Convert map to sorted array
    const months = Array.from(monthMap.entries()).map(([key, data]) => {
      const [year, month] = key.split('-').map(Number);
      const d = new Date(year, month, 1);
      return {
        month: d.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        invoiced: data.invoiced,
        collected: data.collected,
      };
    });

    res.json({ months });
  } catch (error) {
    logger.error('Dashboard trends error', { error });
    res.status(500).json({ success: false, error: 'Failed to get trends' });
  }
});

export default router;
