import { Request, Response, NextFunction } from 'express';
import { isAuthEnabled, verifyAccessToken } from '../services/auth.js';
import { consumeSseTicket } from '../utils/sseTicket.js';

export interface AuthedRequest extends Request {
  user?: { userId: number; phone: string; isAdmin: boolean; role: string; roles: string[] };
}

function extractToken(req: Request): string | null {
  // Try Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Fall back to token query param (for EventSource / SSE which can't set headers)
  // NOTE: prefer ?ticket= instead (one-time, short-lived) — this is kept for backward compat
  const tokenParam = req.query.token as string | undefined;
  if (tokenParam) {
    return tokenParam;
  }
  return null;
}

/**
 * Try authenticating via one-time SSE ticket in query param.
 * Returns user info if valid, null if no ticket or invalid.
 * Ticket is consumed (one-time use) on successful validation.
 */
function trySseTicket(req: Request): { userId: number; phone: string; isAdmin: boolean; role: string; roles: string[] } | null {
  const ticket = req.query.ticket as string | undefined;
  if (!ticket) return null;
  return consumeSseTicket(ticket);
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    return next();
  }

  // Try SSE ticket first (one-time use, URL-safe)
  const ticketUser = trySseTicket(req);
  if (ticketUser) {
    req.user = ticketUser;
    return next();
  }
  // If ticket was provided but invalid, reject immediately
  if (req.query.ticket) {
    res.status(401).json({ error: 'ticket invalid or expired' });
    return;
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

  // Try SSE ticket first (one-time use, URL-safe)
  const ticketUser = trySseTicket(req);
  if (ticketUser) {
    if (!ticketUser.roles.includes('admin')) {
      res.status(403).json({ error: 'admin access required' });
      return;
    }
    req.user = ticketUser;
    return next();
  }
  if (req.query.ticket) {
    res.status(401).json({ error: 'ticket invalid or expired' });
    return;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  verifyAccessToken(token)
    .then((user) => {
      req.user = user;
      if (!user.roles.includes('admin')) {
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

  // Try SSE ticket first (one-time use, URL-safe)
  const ticketUser = trySseTicket(req);
  if (ticketUser) {
    if (!ticketUser.roles.includes('admin') && !ticketUser.roles.includes('teacher')) {
      res.status(403).json({ error: 'teacher or admin access required' });
      return;
    }
    req.user = ticketUser;
    return next();
  }
  if (req.query.ticket) {
    res.status(401).json({ error: 'ticket invalid or expired' });
    return;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }

  verifyAccessToken(token)
    .then((user) => {
      req.user = user;
      if (!user.roles.includes('admin') && !user.roles.includes('teacher')) {
        res.status(403).json({ error: 'teacher or admin access required' });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(401).json({ error: 'token invalid or expired' });
    });
}

/**
 * Optional auth: populate req.user when a valid token/ticket is present,
 * but never reject the request. Used by endpoints that should remain
 * publicly accessible but can personalize results for logged-in users
 * (e.g. the books list, which marks each book's favorite status).
 */
export async function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  if (!isAuthEnabled()) {
    return next();
  }
  const ticketUser = trySseTicket(req);
  if (ticketUser) {
    req.user = ticketUser;
    return next();
  }
  const token = extractToken(req);
  if (token) {
    try {
      req.user = await verifyAccessToken(token);
    } catch {
      // invalid token — proceed without a user
    }
  }
  next();
}
