import { Router, Request, Response } from 'express';
import { sendOTP, verifyOTP } from '../services/auth.service';
import { logger } from '../utils/logger';
import { prisma } from '../db/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { SUPER_ADMINS } from '../config/constants';

const router = Router();

// ── Send OTP ──────────────────────────────────────────────
router.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    if (!phone || typeof phone !== 'string' || phone.length < 10) {
      res.status(400).json({ success: false, error: 'Valid phone number required' });
      return;
    }

    // Normalize phone (handle 91 prefix and potential 9191 errors)
    let normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.startsWith('9191')) {
      normalizedPhone = normalizedPhone.substring(2);
    } else if (!normalizedPhone.startsWith('91')) {
      normalizedPhone = `91${normalizedPhone}`;
    }

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
    if (!user) {
      res.status(404).json({ 
        success: false, 
        error: 'Mobile number not registered. Please contact support to get started with BillKaro.' 
      });
      return;
    }

    if (user.isSuspended) {
      res.status(403).json({ 
        success: false, 
        error: 'Your account has been suspended. Please contact support for assistance.' 
      });
      return;
    }

    await sendOTP(normalizedPhone);

    res.json({ success: true, message: 'OTP sent via WhatsApp' });
  } catch (error) {
    logger.error('Send OTP error', { error });
    res.status(500).json({ success: false, error: 'Failed to send OTP' });
  }
});

// ── Verify OTP ────────────────────────────────────────────
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      res.status(400).json({ success: false, error: 'Phone and OTP required' });
      return;
    }

    let normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.startsWith('9191')) {
      normalizedPhone = normalizedPhone.substring(2);
    } else if (!normalizedPhone.startsWith('91')) {
      normalizedPhone = `91${normalizedPhone}`;
    }

    const result = await verifyOTP(normalizedPhone, otp);

    if (!result) {
      res.status(401).json({ success: false, error: 'Invalid or expired OTP' });
      return;
    }

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Verify OTP error', { error });
    res.status(500).json({ success: false, error: 'OTP verification failed' });
  }
});

// ── Get Current Profile ───────────────────────────────────
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
         id: true,
         phone: true,
         businessName: true,
         role: true,
         gstin: true,
         onboardingComplete: true,
         upiId: true,
         businessAddress: true,
         bankAccountNo: true,
         bankIfsc: true,
         bankAccountName: true,
         bankName: true,
         defaultPaymentTermsDays: true,
         subscriptionPlan: true,
         subscriptionStatus: true,
         subscriptionExpiresAt: true,
      }
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Calculate days remaining
    let daysRemaining = 0;
    if (user.subscriptionExpiresAt) {
      const now = new Date();
      const expires = new Date(user.subscriptionExpiresAt);
      const diffTime = expires.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    } else {
      // If no expiry is set, default to 14 days (trial)
      daysRemaining = 14; 
    }



    res.json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        businessName: user.businessName,
        role: SUPER_ADMINS.includes(user.phone) ? 'admin' : user.role,
        gstin: user.gstin,
        onboardingComplete: user.onboardingComplete,
        upiId: user.upiId,
        address: user.businessAddress,
        defaultPaymentTermsDays: user.defaultPaymentTermsDays,
        subscription: {
          plan: user.subscriptionPlan,
          status: user.subscriptionStatus,
          expiresAt: user.subscriptionExpiresAt,
          daysRemaining: daysRemaining
        },
        bankDetails: {
          accountNo: user.bankAccountNo,
          ifsc: user.bankIfsc,
          beneficiaryName: user.bankAccountName,
          bankName: user.bankName,
        }
      }
    });
  } catch (error) {
    logger.error('Get profile error', { error });
    res.status(500).json({ success: false, error: 'Failed to complete request' });
  }
});

// ── Update Current Profile ────────────────────────────────
router.patch('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // businessName is intentionally excluded — it's set during onboarding only
    const { upiId, address, bankAccountNo, bankIfsc, bankAccountName, defaultPaymentTermsDays } = req.body;

    // Validate payment terms if provided
    const updateData: any = {
      upiId,
      businessAddress: address,
      bankAccountNo,
      bankIfsc,
      bankAccountName,
    };

    if (defaultPaymentTermsDays !== undefined) {
      const days = parseInt(defaultPaymentTermsDays, 10);
      if (isNaN(days) || days < 1 || days > 90) {
        res.status(400).json({ success: false, error: 'Payment terms must be between 1 and 90 days' });
        return;
      }
      updateData.defaultPaymentTermsDays = days;
    }

    await prisma.user.update({
      where: { id: req.userId },
      data: updateData,
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    logger.error('Update profile error', { error });
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

export default router;
