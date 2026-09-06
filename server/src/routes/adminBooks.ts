import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';
import { getAvailableDpis } from '../services/pdfProcessor.js';
import { getBookRoot, getCropsRoot } from '../services/storage.js';

const router = Router();
router.get('/', async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const search = req.query.search as string;
  const category = req.query.category as string;
  const grade = req.query.grade as string;
  const subject = req.query.subject as string;
  const batchId = req.query.batchId as string;

  const where: any = {};
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { category: { contains: search } },
      { grade: { contains: search } },
      { subject: { contains: search } },
    ];
  }
  if (category && category !== 'all') where.category = { contains: category };
  if (grade && grade !== 'all') where.grade = { contains: grade };
  if (subject && subject !== 'all') where.subject = { contains: subject };
  if (batchId && batchId !== 'all') where.batchId = batchId;

  const [data, total] = await Promise.all([
    prisma.book.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.book.count({ where }),
  ]);

  const booksWithDpi = data.map(b => {
    const bookDir = getBookRoot(b.id);
    return { ...b, availableDpis: getAvailableDpis(bookDir) };
  });

  res.json({ data: booksWithDpi, total, page, pageSize });
});

// Get distinct batchIds (newest first) for the filter dropdown
router.get('/batches', async (_req: Request, res: Response) => {
  const books = await prisma.book.findMany({
    select: { batchId: true },
    where: { batchId: { not: '' } },
    orderBy: { createdAt: 'desc' },
  });
  const batchIds = [...new Set(books.map(b => b.batchId))].filter(Boolean);
  res.json(batchIds);
});

router.delete('/all', async (_req: Request, res: Response) => {
  try {
    const books = await prisma.book.findMany({ select: { id: true } });
    const booksRoot = path.dirname(getBookRoot(0));
    const cropsRoot = getCropsRoot();
    try { fs.rmSync(booksRoot, { recursive: true, force: true }); } catch { /* files may not exist */ }
    try { fs.rmSync(cropsRoot, { recursive: true, force: true }); } catch { /* files may not exist */ }

    await prisma.book.deleteMany({});
    await prisma.$executeRawUnsafe('ALTER TABLE `Book` AUTO_INCREMENT = 1');
    res.json({ success: true, deleted: books.length });
  } catch (error: any) {
    res.status(500).json({ error: `清空书籍失败: ${error.message}` });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { title, category, grade, subject, coverPage, attributes } = req.body;
  const data: any = {};
  if (title !== undefined) data.title = title;
  if (category !== undefined) data.category = category;
  if (grade !== undefined) data.grade = grade;
  if (subject !== undefined) data.subject = subject;
  if (coverPage !== undefined) data.coverPage = Number(coverPage) || 1;
  if (attributes !== undefined) data.attributes = attributes;

  try {
    const updated = await prisma.book.update({ where: { id }, data });
    res.json(updated);
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

router.post('/all/stream', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type: string, data: any) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const books = await prisma.book.findMany({ select: { id: true, title: true } });
    send('start', { total: books.length });

    for (let index = 0; index < books.length; index += 1) {
      const book = books[index];
      try { fs.rmSync(getBookRoot(book.id), { recursive: true, force: true }); } catch { /* files may not exist */ }
      try { fs.rmSync(path.join(getCropsRoot(), String(book.id)), { recursive: true, force: true }); } catch { /* files may not exist */ }
      send('progress', { current: index + 1, total: books.length, title: book.title });
    }

    await prisma.book.deleteMany({});
    await prisma.$executeRawUnsafe('ALTER TABLE `Book` AUTO_INCREMENT = 1');
    send('done', { success: true, deleted: books.length });
  } catch (error: any) {
    send('error', { error: `清空书籍失败: ${error.message}` });
  } finally {
    res.end();
  }
});

router.delete('/all', async (_req: Request, res: Response) => {
  try {
    const books = await prisma.book.findMany({ select: { id: true } });
    try { fs.rmSync(path.dirname(getBookRoot(0)), { recursive: true, force: true }); } catch { /* files may not exist */ }
    try { fs.rmSync(getCropsRoot(), { recursive: true, force: true }); } catch { /* files may not exist */ }
    await prisma.book.deleteMany({});
    await prisma.$executeRawUnsafe('ALTER TABLE `Book` AUTO_INCREMENT = 1');
    res.json({ success: true, deleted: books.length });
  } catch (error: any) {
    res.status(500).json({ error: `清空书籍失败: ${error.message}` });
  }
});

router.delete('/batch', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids 数组不能为空' });
  }
  const numIds = ids.map(Number).filter(Boolean);
  let deleted = 0;
  for (const id of numIds) {
    try {
      const bookDir = getBookRoot(id);
      try { fs.rmSync(bookDir, { recursive: true, force: true }); } catch { /* files may not exist */ }
      const cropDir = path.join(getCropsRoot(), String(id));
      try { fs.rmSync(cropDir, { recursive: true, force: true }); } catch { /* files may not exist */ }
      await prisma.book.delete({ where: { id } });
      deleted++;
    } catch {
      // skip if not found in DB
    }
  }
  res.json({ success: true, deleted });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const bookDir = getBookRoot(id);
    try { fs.rmSync(bookDir, { recursive: true, force: true }); } catch { /* files may not exist in dev */ }
    const cropDir = path.join(getCropsRoot(), String(id));
    try { fs.rmSync(cropDir, { recursive: true, force: true }); } catch { /* files may not exist in dev */ }

    await prisma.book.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
});

export default router;
