import { Router, Response } from 'express';
import prisma from '../../prisma.js';
import { teacherOrAdminRequired, adminRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * PDF 原生书籍管理端路由（/api/pdf/admin/books）。
 *
 * 与用户态 /api/pdf/books 的区别：
 *   · 返回全量书籍（不按用户过滤），供后台列表展示
 *   · 提供软删除 / 恢复 / 批量操作 / 已删除视图
 *   · 写操作需要 admin
 *
 * 严格只读 pdf_book，不触碰任何现有 Book 表。
 */
const router = Router();
router.use(teacherOrAdminRequired);

function parseIntParam(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

const LIST_SELECT = {
  id: true, title: true, category: true, grade: true, subject: true,
  totalPages: true, coverPage: true, searchable: true, missing: true,
  pdfKind: true, fileSize: true, batchId: true, createdAt: true, updatedAt: true,
} as const;

// ─────────────────────────────────────────────────────────────
// 列表
// ─────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize, 20)));
  const search = String(req.query.search || '').trim();
  const category = String(req.query.category || '').trim();
  const grade = String(req.query.grade || '').trim();
  const subject = String(req.query.subject || '').trim();
  const batchId = String(req.query.batchId || '').trim();
  const missingParam = String(req.query.missing || '').trim();
  const searchable = String(req.query.searchable || '').trim();

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
  if (missingParam === '1') where.missing = true;
  if (missingParam === '0') where.missing = false;
  if (searchable && searchable !== 'all') where.searchable = searchable;

  const [data, total] = await Promise.all([
    prisma.pdfBook.findMany({
      where,
      select: LIST_SELECT,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.pdfBook.count({ where }),
  ]);

  res.json({
    data: data.map((b: any) => ({ ...b, coverUrl: `/api/pdf/books/${b.id}/cover` })),
    total,
    page,
    pageSize,
  });
}));

// ─────────────────────────────────────────────────────────────
// 批次 / 筛选选项
// ─────────────────────────────────────────────────────────────

router.get('/batches', asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const books = await prisma.pdfBook.findMany({
    select: { batchId: true },
    where: { batchId: { not: '' }, isDeleted: false },
    orderBy: { createdAt: 'desc' },
  });
  const batchIds = [...new Set(books.map((b) => b.batchId))].filter(Boolean);
  res.json({ data: batchIds });
}));

router.get('/facets', asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const [grades, subjects, categories, searchables, missing] = await Promise.all([
    prisma.pdfBook.groupBy({ by: ['grade'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.groupBy({ by: ['subject'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.groupBy({ by: ['category'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.groupBy({ by: ['searchable'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.count({ where: { isDeleted: false, missing: true } }),
  ]);
  const norm = (rows: any[]) =>
    rows.filter((r) => r._count._all > 0)
      .map((r) => ({ value: r.grade ?? r.subject ?? r.category ?? r.searchable, count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  res.json({
    data: {
      grades: norm(grades),
      subjects: norm(subjects),
      categories: norm(categories),
      searchables: norm(searchables),
      missing,
    },
  });
}));

// ─────────────────────────────────────────────────────────────
// 详情 / 更新
// ─────────────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });
  res.json({ data: { ...book, coverUrl: `/api/pdf/books/${id}/cover` } });
}));

router.patch('/:id', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const exists = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'pdf book not found' });

  const body = req.body || {};
  const data: any = {};
  if (typeof body.title === 'string') data.title = body.title.trim();
  if (typeof body.category === 'string') data.category = body.category.trim();
  if (typeof body.grade === 'string') data.grade = body.grade.trim();
  if (typeof body.subject === 'string') data.subject = body.subject.trim();
  if (typeof body.coverPage === 'number' && body.coverPage > 0) data.coverPage = body.coverPage;
  if (Array.isArray(body.tocJson)) {
    data.tocJson = body.tocJson;
    data.tocSource = 'manual';
  }
  if (body.attributes && typeof body.attributes === 'object') data.attributes = body.attributes;

  if (!Object.keys(data).length) return res.status(400).json({ error: 'no fields to update' });

  const book = await prisma.pdfBook.update({ where: { id }, data });
  res.json({ data: book });
}));

// ─────────────────────────────────────────────────────────────
// 软删除 / 恢复 / 批量
// ─────────────────────────────────────────────────────────────

router.delete('/:id', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const book = await prisma.pdfBook.findUnique({ where: { id } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });
  if (book.isDeleted) return res.status(400).json({ error: 'already soft-deleted' });
  await prisma.pdfBook.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  res.json({ success: true });
}));

router.post('/:id/restore', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  const book = await prisma.pdfBook.findUnique({ where: { id } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });
  if (!book.isDeleted) return res.status(400).json({ error: 'book is not soft-deleted' });
  await prisma.pdfBook.update({ where: { id }, data: { isDeleted: false, deletedAt: null } });
  res.json({ success: true });
}));

router.get('/deleted/list', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize, 20)));
  const search = String(req.query.search || '').trim();

  const where: any = { isDeleted: true };
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { category: { contains: search } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.pdfBook.findMany({
      where,
      select: LIST_SELECT,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.pdfBook.count({ where }),
  ]);

  res.json({
    data: data.map((b: any) => ({ ...b, coverUrl: `/api/pdf/books/${b.id}/cover` })),
    total,
    page,
    pageSize,
  });
}));

router.post('/batch-delete', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids 数组不能为空' });

  let deleted = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      const book = await prisma.pdfBook.findUnique({ where: { id } });
      if (!book || book.isDeleted) { skipped++; continue; }
      await prisma.pdfBook.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
      deleted++;
    } catch { /* skip */ }
  }
  res.json({ success: true, deleted, skipped });
}));

router.post('/batch-restore', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids 数组不能为空' });

  let restored = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      const book = await prisma.pdfBook.findUnique({ where: { id } });
      if (!book || !book.isDeleted) { skipped++; continue; }
      await prisma.pdfBook.update({ where: { id }, data: { isDeleted: false, deletedAt: null } });
      restored++;
    } catch { /* skip */ }
  }
  res.json({ success: true, restored, skipped });
}));

export default router;
