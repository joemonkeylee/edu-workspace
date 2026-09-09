import { Request, Response, NextFunction } from 'express';
import { isAuthEnabled, verifyAccessToken } from '../services/auth.js';

export interface AuthedRequest extends Request {
  user?: { userId: number; phone: string; isAdmin: boolean };
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'token invalid or expired' });
  }
}

export function adminRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    req.user = verifyAccessToken(token);
    if (!req.user.isAdmin) {
      res.status(403).json({ error: 'admin access required' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'token invalid or expired' });
  }
}
