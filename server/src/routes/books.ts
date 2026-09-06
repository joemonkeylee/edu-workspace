import { Router, Request, Response } from 'express';
import path from 'path';
import prisma from '../prisma.js';
import { getBestDpiPath, getAvailableDpis } from '../services/pdfProcessor.js';

const router = Router();

const STORAGE_ABS = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');

router.get('/', async (req: Request, res: Response) => {
  const category = req.query.category as string;
  const grade = req.query.grade as string;
  const subject = req.query.subject as string;

  const where: any = {};
  if (category && category !== 'all') where.category = category;
  if (grade && grade !== 'all') where.grade = grade;
  if (subject && subject !== 'all') where.subject = subject;

  const books = await prisma.book.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  const booksWithDpi = books.map(b => {
    const bookDir = path.join(STORAGE_ABS, 'books', String(b.id));
    const dpis = getAvailableDpis(bookDir);
    return { ...b, availableDpis: dpis };
  });
  res.json(booksWithDpi);
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
  const bookDir = path.join(STORAGE_ABS, 'books', String(id));
  const best = getBestDpiPath(bookDir);
  const storagePath = best ? `/storage/books/${id}/${best.dpi}/` : book.storagePath;
  const dpis = getAvailableDpis(bookDir);
  res.json({ ...book, annotations, storagePath, availableDpis: dpis });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const bookDir = path.join(STORAGE_ABS, 'books', String(id));
    const cropDir = path.join(STORAGE_ABS, 'crops', String(id));
    const { rmSync } = await import('fs');
    try { rmSync(bookDir, { recursive: true, force: true }); } catch { /* files may not exist in dev */ }
    try { rmSync(cropDir, { recursive: true, force: true }); } catch { /* files may not exist in dev */ }
    await prisma.book.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { title, category, grade, subject } = req.body;
  const data: any = {};
  if (typeof title === 'string') data.title = title;
  if (typeof category === 'string') data.category = category;
  if (typeof grade === 'string') data.grade = grade;
  if (typeof subject === 'string') data.subject = subject;
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: '没有可更新的字段' });
  }
  try {
    const updated = await prisma.book.update({ where: { id }, data });
    res.json(updated);
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

export default router;
