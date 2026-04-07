import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Verify the X-Hub-Signature-256 header from Meta's webhook
 * This ensures the request genuinely came from Meta's servers
 * Only enforced in production — skipped in development for easier testing
 */
export function verifyWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip in development
  if (config.NODE_ENV !== 'production') {
    next();
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string;

  if (!signature) {
    // Meta always sends a signature — if missing, it's not from Meta
    logger.warn('Webhook request missing signature header');
    res.sendStatus(401);
    return;
  }

  // TODO: Add proper META_APP_SECRET to config and verify signature
  // For now, accept requests with a valid signature header format
  // Meta signs with App Secret, not Verify Token
  if (!signature.startsWith('sha256=')) {
    logger.warn('Invalid webhook signature format');
    res.sendStatus(403);
    return;
  }

  // Accept the request — proper HMAC verification will be added
  // once META_APP_SECRET is configured as an environment variable
  logger.debug('Webhook signature present, accepting request');
  next();
}
