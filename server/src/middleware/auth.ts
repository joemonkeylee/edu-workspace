import { Request, Response, NextFunction } from 'express';
import { isAuthEnabled, verifyAccessToken } from '../services/auth.js';

export interface AuthedRequest extends Request {
  user?: { userId: number; phone: string; isAdmin: boolean; role: string };
}

function extractToken(req: Request): string | null {
  // Try Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Fall back to token query param (for EventSource / SSE which can't set headers)
  const tokenParam = req.query.token as string | undefined;
  if (tokenParam) {
    return tokenParam;
  }
  return null;
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  verifyAccessToken(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'token invalid or expired' });
    });
}

export function adminRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  verifyAccessToken(token)
    .then((user) => {
      req.user = user;
      if (!user.isAdmin) {
        res.status(403).json({ error: 'admin access required' });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'token invalid or expired' });
    });
}

export function teacherOrAdminRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  verifyAccessToken(token)
    .then((user) => {
      req.user = user;
      if (!user.isAdmin && user.role !== 'teacher') {
        res.status(403).json({ error: 'teacher or admin access required' });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'token invalid or expired' });
    });
}
