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
    const { id } = req.params;
    const { daysToAdd, expiresAt } = req.body;

    let updateData: any = {};

    if (expiresAt) {
      updateData.subscriptionExpiresAt = new Date(expiresAt);
    } else if (daysToAdd != null) {
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + daysToAdd);
      updateData.subscriptionExpiresAt = newExpiry;
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
