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
    logger.warn('Webhook request missing signature header');
    res.sendStatus(401);
    return;
  }

  // Compute expected signature
  const body = JSON.stringify(req.body);
  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', config.WHATSAPP_VERIFY_TOKEN)
      .update(body)
      .digest('hex');

  if (signature !== expectedSignature) {
    logger.warn('Webhook signature mismatch', {
      received: signature.substring(0, 20) + '...',
    });
    res.sendStatus(403);
    return;
  }

  next();
}
