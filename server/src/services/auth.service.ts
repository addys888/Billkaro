import { prisma } from '../db/prisma';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { sendTextMessage, sendTemplateMessage } from './whatsapp.service';
import { SUPER_ADMINS } from '../config/constants';
import { logger } from '../utils/logger';



/**
 * Generate and send OTP via WhatsApp
 * Uses template message in production (required to initiate conversations)
 * Uses plain text in development (simpler for testing)
 */
export async function sendOTP(phone: string): Promise<void> {
  // Generate 6-digit OTP
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Save OTP to database
  await prisma.otp.create({
    data: { phone, code, expiresAt },
  });

  // Get the bot's own phone number (can't send WhatsApp to itself)
  const botPhone = config.WHATSAPP_PHONE_NUMBER_ID ? `91${process.env.BOT_PHONE || '8887360053'}` : '';

  if (phone === botPhone || phone === '918887360053') {
    // Bot's own number — can't send WhatsApp to itself
    // OTP is saved in DB; admin must check Railway logs for bot login
    logger.info(`🔐 OTP generated for bot number (***${phone.slice(-4)}). Check DB to retrieve code.`);
    return;
  }

  if (config.NODE_ENV === 'production') {
    // Send OTP via WhatsApp text message
    await sendTextMessage({
      to: phone,
      text: `🔐 Your BillKaro login OTP is: *${code}*\n\nValid for 10 minutes. Do not share with anyone.`,
    });
  } else {
    // Development: Log OTP to console (skip WhatsApp API)
    logger.info(`\n${'='.repeat(50)}\n🔐 DEV OTP for ${phone}: ${code}\n${'='.repeat(50)}\n`);
    
    // Optionally try WhatsApp, but don't fail if it errors
    try {
      await sendTextMessage({
        to: phone,
        text: `🔐 Your BillKaro login OTP is: *${code}*\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
      });
    } catch (whatsappErr) {
      logger.warn('WhatsApp send failed (dev mode — OTP logged to console above)');
    }
  }

  logger.info('OTP sent', { phone: phone.slice(-4), mode: config.NODE_ENV });
}

/**
 * Verify OTP and return JWT token
 */
export async function verifyOTP(
  phone: string,
  code: string
): Promise<{ token: string; user: any } | null> {
  // Find the latest unverified OTP for this phone
  const otp = await prisma.otp.findFirst({
    where: {
      phone,
      code,
      verified: false,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) {
    return null; // Invalid or expired OTP
  }

  // Mark OTP as verified
  await prisma.otp.update({
    where: { id: otp.id },
    data: { verified: true },
  });

  // Find user — must already exist (invite-only; admin pre-registers merchants)
  const user = await prisma.user.findUnique({ where: { phone } });

  if (!user) {
    // This should never happen: send-otp route blocks unregistered users.
    // But if it does, refuse login rather than silently creating an account.
    logger.warn('OTP verified but no user record found — possible bypass attempt', { phone: phone.slice(-4) });
    return null;
  }

  // Generate JWT
  const token = jwt.sign(
    { userId: user.id, phone: user.phone },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN as any }
  );

  return {
    token,
    user: {
      id: user.id,
      phone: user.phone,
      businessName: user.businessName,
      gstin: user.gstin,
      onboardingComplete: user.onboardingComplete,
      upiId: user.upiId,
      address: user.businessAddress,
      role: SUPER_ADMINS.includes(user.phone) ? 'admin' : user.role,
      subscription: {
        plan: user.subscriptionPlan,
        status: user.subscriptionStatus,
        expiresAt: user.subscriptionExpiresAt,
        daysRemaining: user.subscriptionExpiresAt 
          ? Math.max(0, Math.ceil((new Date(user.subscriptionExpiresAt).getTime() - Date.now()) / 86400000))
          : 0
      },
      bankDetails: {
        accountNo: user.bankAccountNo,
        ifsc: user.bankIfsc,
        beneficiaryName: user.bankAccountName,
        bankName: user.bankName,
      }
    },
  };
}

/**
 * Verify a JWT token and return the user
 */
export async function verifyToken(token: string): Promise<any | null> {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });
    return user;
  } catch {
    return null;
  }
}

/**
 * Clean up expired OTPs (run periodically)
 */
export async function cleanupExpiredOTPs(): Promise<void> {
  await prisma.otp.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
