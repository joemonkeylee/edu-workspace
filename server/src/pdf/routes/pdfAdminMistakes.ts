import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../prisma.js';
import { teacherOrAdminRequired, adminRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getPdfRoot } from '../services/pdfStorage.js';

/**
 * PDF 原生错题管理端路由（/api/pdf/admin/mistakes）。
 *
 * 与用户态 /api/pdf/mistakes 的区别：
 *   · 不要求 bookId，返回全部错题（跨书）
 *   · 支持学科 / 标签 / 复习状态筛选
 *   · 删除需要 admin
 */
const router = Router();
router.use(teacherOrAdminRequired);

function parseIntParam(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

router.get('/', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize, 20)));
  const bookId = parseIntParam(req.query.bookId, NaN);
  const subject = String(req.query.subject || '').trim();
  const tag = String(req.query.tag || '').trim();
  const reviewStatus = String(req.query.reviewStatus || '').trim();

  const where: any = {};
  if (Number.isFinite(bookId)) where.bookId = bookId;
  if (subject && subject !== 'all') where.subject = subject;
  if (tag) where.tags = { contains: tag };
  if (reviewStatus === '0' || reviewStatus === '1' || reviewStatus === '2') {
    where.reviewStatus = Number(reviewStatus);
  }

  const [data, total] = await Promise.all([
    prisma.pdfMistake.findMany({
      where,
      include: { book: { select: { id: true, title: true, grade: true, subject: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pdfMistake.count({ where }),
  ]);

  res.json({
    data: data.map((m: any) => ({ ...m, imageUrl: `/api/pdf/mistakes/${m.id}/image` })),
    total,
    page,
    pageSize,
  });
}));

router.patch('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = await prisma.pdfMistake.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'mistake not found' });

  const data: any = {};
  if (typeof req.body?.reviewStatus === 'number') data.reviewStatus = req.body.reviewStatus;
  if (typeof req.body?.subject === 'string') data.subject = req.body.subject;
  if (typeof req.body?.tags === 'string') data.tags = req.body.tags;

  const updated = await prisma.pdfMistake.update({ where: { id }, data });
  res.json({ data: { ...updated, imageUrl: `/api/pdf/mistakes/${updated.id}/image` } });
}));

router.delete('/:id', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = await prisma.pdfMistake.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'mistake not found' });

  try {
    const abs = path.resolve(getPdfRoot(), existing.imagePath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* 文件删除失败不阻断 */ }

  await prisma.pdfMistake.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
