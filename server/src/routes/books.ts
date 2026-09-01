import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const books = await prisma.book.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(books);
});

router.get('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) {
    return res.status(404).json({ error: '书籍不存在' });
  }
  const annotations = await prisma.annotation.findMany({
    where: { bookId: id },
    orderBy: { pageNumber: 'asc' },
  });
  res.json({ ...book, annotations });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    await prisma.book.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

export default router;
