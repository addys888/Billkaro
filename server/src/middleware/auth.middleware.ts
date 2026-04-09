import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth.service';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

/**
 * JWT authentication middleware
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const user = await verifyToken(token);

    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
      return;
    }

    req.userId = user.id;
    req.user = user;

    // Block suspended users
    if (user.isSuspended) {
      res.status(403).json({ success: false, error: 'Your account has been suspended. Please contact support.' });
      return;
    }

    next();
  } catch (error) {
    logger.error('Auth middleware error', { error });
    res.status(401).json({ success: false, error: 'Authentication failed' });
  }
}
