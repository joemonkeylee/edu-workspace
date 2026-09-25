import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../prisma.js';
import { authRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getPdfRoot } from '../services/pdfStorage.js';

/**
 * PDF 域的错题（/api/pdf/mistakes）。
 * 裁图由 /:id/image 直出 —— 见 pdfAnnotations.ts 里关于为什么不复用
 * /storage/crops 鉴权中间件的说明。
 */
const router = Router();
router.use(authRequired);

function parseIntParam(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function getUserId(req: AuthedRequest): number | null {
  return typeof req.user?.userId === 'number' ? req.user.userId : null;
}

function canViewMistake(req: AuthedRequest, m: { userId: number | null }): boolean {
  if (!req.user) return true; // standalone：不做隔离
  if (req.user.isAdmin || req.user.roles?.includes('teacher')) return true;
  return m.userId === req.user.userId;
}

router.get('/', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize, 50)));
  const bookId = parseIntParam(req.query.bookId, NaN);
  const subject = String(req.query.subject || '').trim();
  const reviewStatus = String(req.query.reviewStatus || '').trim();

  const userId = getUserId(req);
  const canViewAll = Boolean(req.user?.isAdmin || req.user?.roles?.includes('teacher'));
  const where: any = {};
  if (Number.isFinite(bookId)) where.bookId = bookId;
  if (subject) where.subject = subject;
  if (reviewStatus === '0' || reviewStatus === '1') where.reviewStatus = Number(reviewStatus);
  if (userId && !canViewAll) where.userId = userId;

  const [rows, total] = await Promise.all([
    prisma.pdfMistake.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        book: { select: { id: true, title: true, grade: true, subject: true } },
      },
    }),
    prisma.pdfMistake.count({ where }),
  ]);

  res.json({
    data: rows.map((m: any) => ({ ...m, imageUrl: `/api/pdf/mistakes/${m.id}/image` })),
    total,
    page,
    pageSize,
  });
}));

/** 裁图直出。standalone 开放；鉴权开启时按错题归属做隔离。 */
router.get('/:id/image', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const mistake = await prisma.pdfMistake.findUnique({ where: { id } });
  if (!mistake) return res.status(404).json({ error: 'mistake not found' });
  if (!canViewMistake(req, mistake)) return res.status(403).json({ error: 'access denied' });

  const abs = path.resolve(getPdfRoot(), mistake.imagePath);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'image missing' });

  const ext = path.extname(abs).toLowerCase();
  const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
        : 'image/png';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(abs).pipe(res);
}));

router.patch('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = await prisma.pdfMistake.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'mistake not found' });
  if (!canViewMistake(req, existing)) return res.status(403).json({ error: 'access denied' });

  const data: any = {};
  if (typeof req.body?.reviewStatus === 'number') data.reviewStatus = req.body.reviewStatus;
  if (typeof req.body?.subject === 'string') data.subject = req.body.subject;
  if (typeof req.body?.tags === 'string') data.tags = req.body.tags;

  const updated = await prisma.pdfMistake.update({ where: { id }, data });
  res.json({ data: { ...updated, imageUrl: `/api/pdf/mistakes/${updated.id}/image` } });
}));

router.delete('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = await prisma.pdfMistake.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'mistake not found' });
  if (!canViewMistake(req, existing)) return res.status(403).json({ error: 'access denied' });

  try {
    const abs = path.resolve(getPdfRoot(), existing.imagePath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* 文件删除失败不阻断 */ }

  await prisma.pdfMistake.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
