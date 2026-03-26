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

export default router;
