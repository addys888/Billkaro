import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

/**
 * Middleware to restrict access to ADMIN only
 */
export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Access denied. Admin privileges required.' });
    return;
  }
  next();
}
