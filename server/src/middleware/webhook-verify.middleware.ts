import { Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Verify WhatsApp webhook subscription (GET request from Meta)
 */
export function verifyWhatsAppWebhook(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.WHATSAPP_VERIFY_TOKEN) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed', { mode, token });
    res.status(403).send('Forbidden');
  }
}
