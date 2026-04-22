import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { SUPER_ADMINS } from '../config/constants';


/**
 * Middleware to restrict access to ADMIN only
 */
export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const userPhone = req.user?.phone;
  const isAdmin = req.user?.role === 'admin' || (userPhone && SUPER_ADMINS.includes(userPhone));

  if (!isAdmin) {
    res.status(403).json({ success: false, error: 'Access denied. Admin privileges required.' });
    return;
  }
  next();
}
