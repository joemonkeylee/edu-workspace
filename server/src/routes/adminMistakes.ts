import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';

const router = Router();
const STORAGE_ABS = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');

router.get('/', async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const subject = req.query.subject as string;
  const reviewStatus = req.query.reviewStatus as string;
  const tag = req.query.tag as string;

  const where: any = {};
  if (subject && subject !== 'all') where.subject = subject;
  if (reviewStatus !== undefined && reviewStatus !== 'all') {
    where.reviewStatus = Number(reviewStatus);
  }
  if (tag) where.tags = { contains: tag };

  const [data, total] = await Promise.all([
    prisma.mistake.findMany({
      where,
      include: { book: { select: { title: true, category: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.mistake.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
});

router.put('/:id', async (req: Request, res: Response) => {
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
    const mistake = await prisma.mistake.findUnique({ where: { id } });
    if (mistake?.imagePath) {
      const filePath = path.join(STORAGE_ABS, mistake.imagePath.replace('/storage/', ''));
      try { fs.rmSync(filePath, { force: true }); } catch { /* file may not exist in dev */ }
    }
    await prisma.mistake.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '错题不存在' });
  }
});

export default router;
