import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';

const router = Router();
const STORAGE_ABS = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');

router.get('/', async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const search = req.query.search as string;
  const category = req.query.category as string;

  const where: any = {};
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { category: { contains: search } },
    ];
  }
  if (category && category !== 'all') where.category = { contains: category };

  const [data, total] = await Promise.all([
    prisma.book.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.book.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
});

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { title, category } = req.body;
  const data: any = {};
  if (title !== undefined) data.title = title;
  if (category !== undefined) data.category = category;

  try {
    const updated = await prisma.book.update({ where: { id }, data });
    res.json(updated);
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const bookDir = path.join(STORAGE_ABS, 'books', String(id));
    fs.rmSync(bookDir, { recursive: true, force: true });
    const cropDir = path.join(STORAGE_ABS, 'crops', String(id));
    fs.rmSync(cropDir, { recursive: true, force: true });

    await prisma.book.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

export default router;
