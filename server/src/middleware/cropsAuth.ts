import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';
import { getCropsRoot } from '../services/storage.js';
import { isAuthEnabled, verifyAccessToken } from '../services/auth.js';

/**
 * Middleware to protect /storage/crops/* images.
 *
 * When AUTH_ENABLED=false: pass through (open access)
 * When AUTH_ENABLED=true:
 *   - admin / teacher: full access
 *   - student: only their own crop images (verified via mistake table)
 *
 * Token is extracted from Authorization header or ?token= query param.
 */
export async function cropsAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  // Auth disabled: open access
  if (!isAuthEnabled()) {
    return next();
  }

  // Parse path: /storage/crops/{bookId}/{filename}
  const pathParts = req.path.split('/').filter(Boolean);
  // path is like /crops/123/image.png when mounted at /storage
  // But the URL is /storage/crops/123/image.png, and we mount at /storage/crops
  // So req.path will be /{bookId}/{filename}
  const bookIdStr = pathParts[0];
  const filename = pathParts[1];

  if (!bookIdStr || !filename) {
    return res.status(400).json({ error: 'invalid path' });
  }

  const bookId = parseInt(bookIdStr, 10);
  if (isNaN(bookId)) {
    return res.status(400).json({ error: 'invalid bookId' });
  }

  // Sanitize filename
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'invalid filename' });
  }

  // Extract token (header or query param for <img> tag requests)
  let token: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'authentication required' });
  }

  let user: { userId: number; isAdmin: boolean; role: string };
  try {
    user = await verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'token invalid or expired' });
  }

  // Admin and teacher can access all crops
  if (user.isAdmin || user.role === 'teacher') {
    return next();
  }

  // Student: verify this crop belongs to them via the mistake table
  const imagePath = `/storage/crops/${bookId}/${filename}`;
  const mistake = await prisma.mistake.findFirst({
    where: {
      bookId,
      imagePath,
    },
    select: { userId: true },
  });

  if (!mistake) {
    // No mistake record found — could be an orphaned file or annotation crop
    // Try to find via annotation
    const annotations = await prisma.annotation.findMany({
      where: {
        bookId,
        type: 'crop',
        userId: user.userId,
      },
      select: { contentJson: true },
    });

    const owns = annotations.some((a) => {
      try {
        const json = a.contentJson as any;
        return json?.path?.includes(filename) || json?.filename === filename;
      } catch {
        return false;
      }
    });

    if (!owns) {
      return res.status(403).json({ error: 'access denied' });
    }
  } else if (mistake.userId === null || mistake.userId !== user.userId) {
    // Anonymous (null) crops are only accessible to admin/teacher (handled above)
    // Students can only access their own crops
    return res.status(403).json({ error: 'access denied' });
  }

  // Verify file actually exists before passing through
  const filePath = path.join(getCropsRoot(), String(bookId), filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'not found' });
  }

  next();
}
