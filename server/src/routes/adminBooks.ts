import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';
import { getAvailableDpis } from '../services/pdfProcessor.js';
import {
  getBookRoot,
  getCropsRoot,
  moveBookToDeleted,
  restoreBookFromDeleted,
  getBookDeletedRoot,
} from '../services/storage.js';
import { adminRequired, teacherOrAdminRequired, AuthedRequest } from '../middleware/auth.js';
import { invalidateBookIndexOnWrite } from '../middleware/bookIndex.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(teacherOrAdminRequired);
// 写操作后让全局书籍索引（答案页集合 / 配对清单 / Tab 计数）失效并后台重建
router.use(invalidateBookIndexOnWrite);

// ── List active books (soft-deleted excluded by default) ──────────

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const search = req.query.search as string;
  const category = req.query.category as string;
  const grade = req.query.grade as string;
  const subject = req.query.subject as string;
  const batchId = req.query.batchId as string;

  const where: any = { isDeleted: false };
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
}));

// ── Get distinct batchIds (newest first) ───────────────────────────

router.get('/batches', asyncHandler(async (_req: Request, res: Response) => {
  const books = await prisma.book.findMany({
    select: { batchId: true },
    where: { batchId: { not: '' }, isDeleted: false },
    orderBy: { createdAt: 'desc' },
  });
  const batchIds = [...new Set(books.map(b => b.batchId))].filter(Boolean);
  res.json({ data: batchIds });
}));

// ── Soft-delete a book (flag DB + move resources) ──────────────────

router.post('/:id/soft-delete', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) return res.status(404).json({ error: 'book not found' });
  if (book.isDeleted) return res.status(400).json({ error: 'already soft-deleted' });

  const resourcesMoved = moveBookToDeleted(id);
  await prisma.book.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  res.json({ success: true, resourcesMoved });
}));

// ── Restore a soft-deleted book ─────────────────────────────────────

router.post('/:id/restore', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) return res.status(404).json({ error: 'book not found' });
  if (!book.isDeleted) return res.status(400).json({ error: 'book is not soft-deleted' });

  const resourcesRestored = restoreBookFromDeleted(id);
  if (!resourcesRestored) {
    // DB record can be restored but resource folder is gone
    await prisma.book.update({
      where: { id },
      data: { isDeleted: false, deletedAt: null },
    });
    return res.json({ success: true, resourcesRestored: false, warning: '资源目录不存在，已恢复数据库记录但无法还原存储文件' });
  }

  await prisma.book.update({
    where: { id },
    data: { isDeleted: false, deletedAt: null },
  });

  res.json({ success: true, resourcesRestored: true });
}));

// ── List soft-deleted books ────────────────────────────────────────

router.get('/deleted', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const search = req.query.search as string;

  const where: any = { isDeleted: true };
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { category: { contains: search } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.book.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.book.count({ where }),
  ]);

  // Flag which ones have resources still available in books-deleted
  const withResource = data.map((b) => ({
    ...b,
    hasResources: fs.existsSync(getBookDeletedRoot(b.id)),
  }));

  res.json({ data: withResource, total, page, pageSize });
}));

// ── Batch soft-delete ──────────────────────────────────────────────

router.post('/soft-delete-batch', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids 数组不能为空' });
  }
  const numIds = ids.map((n) => Number(n)).filter((n) => n > 0);
  let success = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const id of numIds) {
    try {
      const book = await prisma.book.findUnique({ where: { id } });
      if (!book || book.isDeleted) { skipped++; continue; }
      moveBookToDeleted(id);
      await prisma.book.update({
        where: { id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      success++;
    } catch (e: any) {
      errors.push(`#${id}: ${e?.message || 'unknown'}`);
    }
  }
  res.json({ success: true, deleted: success, skipped, errors });
}));

// ── Batch restore ──────────────────────────────────────────────────

router.post('/restore-batch', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids 数组不能为空' });
  }
  const numIds = ids.map((n) => Number(n)).filter((n) => n > 0);
  let restored = 0;
  let skipped = 0;
  let noResource = 0;
  const errors: string[] = [];
  for (const id of numIds) {
    try {
      const book = await prisma.book.findUnique({ where: { id } });
      if (!book || !book.isDeleted) { skipped++; continue; }
      const hasResources = fs.existsSync(getBookDeletedRoot(id));
      if (hasResources) {
        restoreBookFromDeleted(id);
        restored++;
      } else {
        noResource++;
      }
      await prisma.book.update({
        where: { id },
        data: { isDeleted: false, deletedAt: null },
      });
    } catch (e: any) {
      errors.push(`#${id}: ${e?.message || 'unknown'}`);
    }
  }
  res.json({ success: true, restored, noResource, skipped, errors });
}));

// ── Physical delete ALL books ──────────────────────────────────────

router.delete('/all', adminRequired, asyncHandler(async (_req: Request, res: Response) => {
  const books = await prisma.book.findMany({ select: { id: true } });
  const booksRoot = path.dirname(getBookRoot(0));
  const cropsRoot = getCropsRoot();
  try { fs.rmSync(booksRoot, { recursive: true, force: true }); } catch { /* files may not exist */ }
  try { fs.rmSync(cropsRoot, { recursive: true, force: true }); } catch { /* files may not exist */ }
  await prisma.book.deleteMany({});
  res.json({ success: true, deleted: books.length });
}));

router.delete('/all/stream', adminRequired, asyncHandler(async (_req: Request, res: Response) => {
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
    send('done', { success: true, deleted: books.length });
  } catch (error: any) {
    send('error', { error: `清空书籍失败: ${error.message}` });
  } finally {
    res.end();
  }
}));

// ── Physical batch delete (still removes DB + resources) ────────────

router.delete('/batch', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids 数组不能为空' });
  }
  const numIds = ids.map(Number).filter(Boolean);
  let deleted = 0;
  for (const id of numIds) {
    try {
      // Try active dir first, fall back to deleted dir
      const activeDir = getBookRoot(id);
      const deletedDir = getBookDeletedRoot(id);
      if (fs.existsSync(activeDir)) try { fs.rmSync(activeDir, { recursive: true, force: true }); } catch { /* */ }
      if (fs.existsSync(deletedDir)) try { fs.rmSync(deletedDir, { recursive: true, force: true }); } catch { /* */ }
      const cropDir = path.join(getCropsRoot(), String(id));
      try { fs.rmSync(cropDir, { recursive: true, force: true }); } catch { /* files may not exist */ }
      await prisma.book.delete({ where: { id } });
      deleted++;
    } catch {
      // skip if not found in DB
    }
  }
  res.json({ success: true, deleted });
}));

// ── Physical delete single book ────────────────────────────────────

router.delete('/:id', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const activeDir = getBookRoot(id);
  const deletedDir = getBookDeletedRoot(id);
  if (fs.existsSync(activeDir)) try { fs.rmSync(activeDir, { recursive: true, force: true }); } catch { /* */ }
  if (fs.existsSync(deletedDir)) try { fs.rmSync(deletedDir, { recursive: true, force: true }); } catch { /* */ }
  const cropDir = path.join(getCropsRoot(), String(id));
  try { fs.rmSync(cropDir, { recursive: true, force: true }); } catch { /* files may not exist */ }
  await prisma.book.delete({ where: { id } });
  res.json({ success: true });
}));

router.put('/:id', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { title, category, grade, subject, coverPage, attributes } = req.body;
  const data: any = {};
  if (title !== undefined) data.title = title;
  if (category !== undefined) data.category = category;
  if (grade !== undefined) data.grade = grade;
  if (subject !== undefined) data.subject = subject;
  if (coverPage !== undefined) data.coverPage = Number(coverPage) || 1;
  if (attributes !== undefined) data.attributes = attributes;

  const updated = await prisma.book.update({ where: { id }, data });
  res.json({ data: updated });
}));

export default router;
