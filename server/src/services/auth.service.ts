import { prisma } from '../db/prisma';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { sendTextMessage } from './whatsapp.service';
import { logger } from '../utils/logger';



/**
 * Generate and send OTP via WhatsApp
 */
export async function sendOTP(phone: string): Promise<void> {
  // Generate 6-digit OTP
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Save OTP to database
  await prisma.otp.create({
    data: { phone, code, expiresAt },
  });

  // Send via WhatsApp
  await sendTextMessage({
    to: phone,
    text: `🔐 Your BillKaro login OTP is: *${code}*\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
  });

  logger.info('OTP sent', { phone: phone.slice(-4) });
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
    // Create new user (they'll complete onboarding via WhatsApp)
    user = await prisma.user.create({
      data: {
        phone,
        businessName: 'My Business', // Placeholder, updated during onboarding
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
