import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const bookId = req.query.bookId as string;
  const type = req.query.type as string;

  const where: any = {};
  if (bookId) where.bookId = Number(bookId);
  if (type && type !== 'all') where.type = type;

  const [data, total] = await Promise.all([
    prisma.annotation.findMany({
      where,
      include: { book: { select: { title: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.annotation.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    await prisma.annotation.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '批注不存在' });
  }
});

export default router;
