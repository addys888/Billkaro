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
      prisma.user.count({ where: { role: { not: 'super_admin' } } }),
      prisma.user.count({ where: { role: { not: 'super_admin' }, subscriptionStatus: 'active', isSuspended: false } }),
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
 * [GET] List all users (SMEs) — paginated
 * Query params: ?page=1&limit=50&search=keyword
 */
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const search = (req.query.search as string || '').trim();
    const skip = (page - 1) * limit;

    // Build search filter — exclude super_admin accounts (system accounts)
    const baseFilter = { role: { not: 'super_admin' } };
    const where = search
      ? {
          ...baseFilter,
          OR: [
            { phone: { contains: search } },
            { businessName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : baseFilter;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          phone: true,
          businessName: true,
          role: true,
          isSuspended: true,
          onboardingComplete: true,
          upiId: true,
          subscriptionPlan: true,
          subscriptionStatus: true,
          subscriptionExpiresAt: true,
          createdAt: true,
        }
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
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

    const user = await prisma.user.findUnique({ where: { id }, select: { subscriptionExpiresAt: true } });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const currentExpiry = user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) > new Date()
      ? new Date(user.subscriptionExpiresAt)
      : new Date();

    if (expiresAt) {
      updateData.subscriptionExpiresAt = new Date(expiresAt);
    } else if (monthsToAdd != null) {
      const newExpiry = new Date(currentExpiry);
      newExpiry.setMonth(newExpiry.getMonth() + monthsToAdd);
      updateData.subscriptionExpiresAt = newExpiry;
      updateData.subscriptionStatus = 'active';
    } else if (daysToAdd != null) {
      const newExpiry = new Date(currentExpiry);
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

/**
 * [PATCH] Update user profile (business name, etc.)
 */
router.patch('/users/:id/profile', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { businessName } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const updateData: any = {};
    if (businessName) updateData.businessName = businessName;

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    logger.info('Admin updated user profile', { userId: id, changes: updateData, adminPhone: req.user?.phone });

    res.json({
      success: true,
      message: 'User profile updated',
      user: { id: updated.id, phone: updated.phone, businessName: updated.businessName },
    });
  } catch (error) {
    logger.error('Admin profile update error', { error });
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

/**
 * [POST] Pre-register a new merchant (whitelist for bot access)
 * Creates a minimal user record; merchant completes onboarding via WhatsApp
 */
router.post('/users', async (req: AuthRequest, res: Response) => {
  try {
    const { phone, businessName } = req.body;

    if (!phone) {
      res.status(400).json({ success: false, error: 'Phone number is required' });
      return;
    }

    let normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.startsWith('9191')) {
      normalizedPhone = normalizedPhone.substring(2);
    } else if (!normalizedPhone.startsWith('91')) {
      normalizedPhone = `91${normalizedPhone}`;
    }

    // Check if already exists
    const existing = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
    if (existing) {
      res.status(409).json({ success: false, error: 'This phone number is already registered' });
      return;
    }

    // Create pre-approved user (onboarding not complete — bot will guide them)
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 7);

    const user = await prisma.user.create({
      data: {
        phone: normalizedPhone,
        businessName: businessName || 'New Business',
        onboardingComplete: false,
        subscriptionPlan: 'Trial',
        subscriptionStatus: 'active',
        subscriptionExpiresAt: trialExpiry,
      },
    });

    logger.info('Admin pre-registered merchant', { phone: normalizedPhone, adminPhone: req.user?.phone });

    res.json({
      success: true,
      message: `Merchant ${normalizedPhone} pre-registered. They can now message the bot to complete onboarding.`,
      user: { id: user.id, phone: user.phone, businessName: user.businessName },
    });
  } catch (error) {
    logger.error('Admin add user error', { error });
    res.status(500).json({ success: false, error: 'Failed to register merchant' });
  }
});

export default router;
