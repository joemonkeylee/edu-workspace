import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const { subject, reviewStatus, bookId, tag } = req.query;
  const where: any = {};
  if (subject) where.subject = subject;
  if (reviewStatus !== undefined) where.reviewStatus = parseInt(reviewStatus as string, 10);
  if (bookId) where.bookId = parseInt(bookId as string, 10);
  if (tag) where.tags = { contains: tag as string };

  const mistakes = await prisma.mistake.findMany({
    where,
    include: { book: { select: { title: true, category: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(mistakes);
});

router.patch('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { reviewStatus, tags, subject } = req.body;
  const data: any = {};
  if (reviewStatus !== undefined) data.reviewStatus = reviewStatus;
  if (tags !== undefined) data.tags = tags;
  if (subject !== undefined) data.subject = subject;

  try {
    const updated = await prisma.mistake.update({ where: { id }, data });
    res.json(updated);
  } catch {
    res.status(404).json({ error: '错题不存在' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    await prisma.mistake.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '错题不存在' });
  }
});

export default router;
