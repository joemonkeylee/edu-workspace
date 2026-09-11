import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(authRequired);

// Get reading progress for a book
router.get('/:bookId', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.params.bookId, 10);
  if (isNaN(bookId)) return res.status(400).json({ error: 'invalid bookId' });

  // In standalone mode, progress is stored client-side via localStorage
  if (!req.user) {
    return res.json({ data: null });
  }

  const progress = await prisma.readingProgress.findUnique({
    where: {
      userId_bookId: {
        userId: req.user.userId,
        bookId,
      },
    },
  });

  res.json({ data: progress });
}));

// Update reading progress for a book (upsert)
router.put('/:bookId', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.params.bookId, 10);
  if (isNaN(bookId)) return res.status(400).json({ error: 'invalid bookId' });

  // In standalone mode, progress is stored client-side
  if (!req.user) {
    return res.status(400).json({ error: 'not available in standalone mode' });
  }

  const { pageNumber, pageLayout, fitMode, rotation } = req.body;
  const data: any = {};
  if (typeof pageNumber === 'number' && pageNumber > 0) data.pageNumber = pageNumber;
  if (typeof pageLayout === 'string') data.pageLayout = pageLayout;
  if (typeof fitMode === 'string') data.fitMode = fitMode;
  if (typeof rotation === 'number') data.rotation = rotation;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'no fields to update' });
  }

  const progress = await prisma.readingProgress.upsert({
    where: {
      userId_bookId: {
        userId: req.user.userId,
        bookId,
      },
    },
    create: {
      userId: req.user.userId,
      bookId,
      ...data,
    },
    update: data,
  });

  res.json({ data: progress });
}));

export default router;
