import { prisma } from '../db/prisma';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { sendTextMessage, sendTemplateMessage } from './whatsapp.service';
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

  if (config.NODE_ENV === 'production') {
    // Send OTP via WhatsApp text message
    // TODO: Switch to sendTemplateMessage('otp_login') once Meta approves the template
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

  // Find or create user
  let user = await prisma.user.findUnique({ where: { phone } });

  if (!user) {
    // Create new user with 14-day trial
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 14);

    user = await prisma.user.create({
      data: {
        phone,
        businessName: 'My Business',
        subscriptionPlan: "Trial",
        subscriptionStatus: "active",
        subscriptionExpiresAt: trialExpiry,
      },
    });
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
      role: ['919452661608', '919082573335'].includes(user.phone) ? 'admin' : user.role,
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
