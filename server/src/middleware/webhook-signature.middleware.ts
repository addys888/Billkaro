import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Verify the X-Hub-Signature-256 header from Meta's webhook
 * This ensures the request genuinely came from Meta's servers
 * Uses HMAC-SHA256 with the Meta App Secret
 */
export function verifyWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip in development for easier testing
  if (config.NODE_ENV !== 'production') {
    next();
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string;

  if (!signature) {
    logger.warn('Webhook request missing signature header');
    res.sendStatus(401);
    return;
  }

  if (!signature.startsWith('sha256=')) {
    logger.warn('Invalid webhook signature format');
    res.sendStatus(403);
    return;
  }

  // If META_APP_SECRET is not configured, log a warning but allow through
  // This prevents breaking existing deployments while the secret is being added
  if (!config.META_APP_SECRET) {
    logger.warn('META_APP_SECRET not configured — webhook signature verification skipped. Set this env var ASAP!');
    next();
    return;
  }

  // Verify HMAC-SHA256 signature
  const rawBody = JSON.stringify(req.body);
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', config.META_APP_SECRET)
    .update(rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )) {
    logger.warn('Webhook signature verification FAILED — possible forgery attempt', {
      receivedSig: signature.substring(0, 20) + '...',
    });
    res.sendStatus(403);
    return;
  }

  next();
}
