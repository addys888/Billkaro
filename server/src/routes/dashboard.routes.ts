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
        client: { select: { name: true } },
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
      } else if (inv.status === InvoiceStatus.OVERDUE) {
        totalOverdue += amount;
        overdueCount++;
        overdueInvoices.push({
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          clientName: inv.client.name,
          totalAmount: amount,
          daysOverdue: Math.floor(
            (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
          ),
        });
      } else if (inv.status === InvoiceStatus.PENDING) {
        totalPending += amount;
        pendingCount++;
        // Check if actually overdue
        if (new Date(inv.dueDate) < now) {
          totalOverdue += amount;
          overdueCount++;
          overdueInvoices.push({
            id: inv.id,
            invoiceNo: inv.invoiceNo,
            clientName: inv.client.name,
            totalAmount: amount,
            daysOverdue: Math.floor(
              (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)
            ),
          });
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
      totalPending: totalPending + totalOverdue - totalOverdue, // Pending = not yet due
      totalOverdue,
      invoiceCount: invoices.length,
      paidCount,
      pendingCount,
      overdueCount,
      collectionRate,
      avgDaysToPay,
      overdueInvoices: overdueInvoices.slice(0, 10),
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
    const months: Array<{ month: string; invoiced: number; collected: number }> = [];

    for (let i = monthCount - 1; i >= 0; i--) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);

      const invoices = await prisma.invoice.findMany({
        where: {
          userId: req.userId,
          createdAt: { gte: start, lte: end },
        },
      });

      let invoiced = 0;
      let collected = 0;
      for (const inv of invoices) {
        invoiced += Number(inv.totalAmount);
        if (inv.status === InvoiceStatus.PAID) {
          collected += Number(inv.totalAmount);
        }
      }

      const monthName = start.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      months.push({ month: monthName, invoiced, collected });
    }

    res.json({ months });
  } catch (error) {
    logger.error('Dashboard trends error', { error });
    res.status(500).json({ success: false, error: 'Failed to get trends' });
  }
});

export default router;
