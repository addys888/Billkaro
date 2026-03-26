import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { getClientsForUser, getClientDetail, updateClient } from '../services/client.service';
import { logger } from '../utils/logger';

const router = Router();

router.use(authMiddleware);

// ── List Clients ──────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', search } = req.query;
    const result = await getClientsForUser(req.userId!, {
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
      search: search as string | undefined,
    });
    res.json(result);
  } catch (error) {
    logger.error('List clients error', { error });
    res.status(500).json({ success: false, error: 'Failed to list clients' });
  }
});

// ── Get Client Detail ─────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const client = await getClientDetail(req.userId!, req.params.id);
    if (!client) {
      res.status(404).json({ success: false, error: 'Client not found' });
      return;
    }
    res.json(client);
  } catch (error) {
    logger.error('Get client error', { error });
    res.status(500).json({ success: false, error: 'Failed to get client' });
  }
});

// ── Update Client ─────────────────────────────────────────
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { name, phone, gstin, email } = req.body;
    const updated = await updateClient(req.userId!, req.params.id, {
      name, phone, gstin, email,
    });
    res.json({ success: true, client: updated });
  } catch (error) {
    logger.error('Update client error', { error });
    res.status(500).json({ success: false, error: 'Failed to update client' });
  }
});

export default router;
