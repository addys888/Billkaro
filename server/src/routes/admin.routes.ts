import { Router, Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthRequest, authMiddleware } from '../middleware/auth.middleware';
import { adminMiddleware } from '../middleware/admin.middleware';
import { logger } from '../utils/logger';

const router = Router();

// All routes here require both standard auth and admin check
router.use(authMiddleware);
router.use(adminMiddleware);

/**
 * [GET] Platform-wide stats for Super Admin
 */
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalUsers, activeUsers, totalInvoices, dailyInvoices, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { subscriptionStatus: 'active', isSuspended: false } }),
      prisma.invoice.count(),
      prisma.invoice.count({ where: { createdAt: { gte: today } } }),
      prisma.invoice.aggregate({
        where: { status: 'PAID' },
        _sum: { totalAmount: true }
      })
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers,
        activeUsers,
        totalInvoices,
        dailyInvoices,
        totalRevenue: Number(revenue._sum.totalAmount || 0)
      }
    });
  } catch (error) {
    logger.error('Admin stats error', { error });
    res.status(500).json({ success: false, error: 'Failed to fetch platform stats' });
  }
});

/**
 * [GET] List all users (SMEs)
 */
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        businessName: true,
        role: true,
        isSuspended: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        subscriptionExpiresAt: true,
        createdAt: true,
      }
    });

    res.json({ success: true, users });
  } catch (error) {
    logger.error('Admin users list error', { error });
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

/**
 * [PATCH] Update user subscription
 */
router.patch('/users/:id/subscription', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { daysToAdd, monthsToAdd, expiresAt, isSuspended } = req.body;

    let updateData: any = {};

    if (isSuspended !== undefined) {
      updateData.isSuspended = isSuspended;
    }

    if (expiresAt) {
      updateData.subscriptionExpiresAt = new Date(expiresAt);
    } else if (monthsToAdd != null) {
      const now = new Date();
      now.setMonth(now.getMonth() + monthsToAdd);
      updateData.subscriptionExpiresAt = now;
      updateData.subscriptionStatus = 'active'; // Reactivate if extending
    } else if (daysToAdd != null) {
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + daysToAdd);
      updateData.subscriptionExpiresAt = newExpiry;
      updateData.subscriptionStatus = 'active';
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData
    });

    res.json({ 
      success: true, 
      message: 'Subscription updated successfully',
      user: updatedUser 
    });
  } catch (error) {
    logger.error('Admin subscription update error', { error });
    res.status(500).json({ success: false, error: 'Failed to update subscription' });
  }
});

export default router;
