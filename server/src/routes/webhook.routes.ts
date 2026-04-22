import { Router, Request, Response } from 'express';
import { handleIncomingMessage } from '../bot/message-handler';
import { verifyWhatsAppWebhook } from '../middleware/webhook-verify.middleware';
import { verifyWebhookSignature } from '../middleware/webhook-signature.middleware';
import { logger } from '../utils/logger';

const router = Router();

// ── WhatsApp Webhook Verification (GET) ───────────────────
router.get('/whatsapp', verifyWhatsAppWebhook);

// ── WhatsApp Incoming Messages (POST) ─────────────────────
router.post('/whatsapp', verifyWebhookSignature, async (req: Request, res: Response) => {
  try {
    // Always respond 200 immediately to WhatsApp
    res.sendStatus(200);

    const body = req.body;

    // Validate it's a WhatsApp webhook
    if (body.object !== 'whatsapp_business_account') return;

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value;

        // Handle status updates (delivery/read receipts)
        if (value.statuses) continue;

        // Handle incoming messages
        const messages = value.messages || [];
        for (const message of messages) {
          const senderPhone = message.from;
          // Process asynchronously to not block the webhook
          handleIncomingMessage(message, senderPhone).catch((err) => {
            logger.error('Error processing message', { senderPhone, error: err });
          });
        }
      }
    }
  } catch (error) {
    logger.error('Webhook processing error', { error });
  }
});

// Note: No payment gateway webhook needed — BillKaro uses direct UPI transfers
// (zero MDR). Payment confirmation is done manually by the merchant via
// "Rahul ne pay kar diya" or the dashboard "Mark Paid" button.

export default router;
