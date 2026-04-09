import { Router, Request, Response } from 'express';
import { sendOTP, verifyOTP } from '../services/auth.service';
import { logger } from '../utils/logger';

const router = Router();

// ── Send OTP ──────────────────────────────────────────────
router.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    if (!phone || typeof phone !== 'string' || phone.length < 10) {
      res.status(400).json({ success: false, error: 'Valid phone number required' });
      return;
    }

    // Normalize phone (ensure starts with 91)
    const normalizedPhone = phone.startsWith('91') ? phone : `91${phone}`;

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
    if (!user) {
      res.status(404).json({ 
        success: false, 
        error: 'Mobile number not registered. Please contact support to get started with BillKaro.' 
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

    const normalizedPhone = phone.startsWith('91') ? phone : `91${phone}`;

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

import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { prisma } from '../db/prisma';

// ── Get Current Profile ───────────────────────────────────
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
         id: true,
         phone: true,
         businessName: true,
         gstin: true,
         onboardingComplete: true,
         upiId: true,
         businessAddress: true,
         bankAccountNo: true,
         bankIfsc: true,
         bankAccountName: true,
         bankName: true,
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
      // If no expiry is set, default to 14 days from registration (trial) for demo purposes
      const trialEnd = new Date(user.id.startsWith('test') ? Date.now() + 14 * 86400000 : user.id.length); // fallback logic
      daysRemaining = 14; 
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        businessName: user.businessName,
        gstin: user.gstin,
        onboardingComplete: user.onboardingComplete,
        upiId: user.upiId,
        address: user.businessAddress,
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
    const { businessName, upiId, address, bankAccountNo, bankIfsc, bankAccountName } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: {
        businessName,
        upiId,
        businessAddress: address,
        bankAccountNo,
        bankIfsc,
        bankAccountName,
      }
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    logger.error('Update profile error', { error });
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

export default router;
