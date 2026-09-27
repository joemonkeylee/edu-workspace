import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../prisma.js';
import { teacherOrAdminRequired, adminRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getPdfRoot } from '../services/pdfStorage.js';

/**
 * PDF 原生批注管理端路由（/api/pdf/admin/annotations）。
 *
 * 与用户态 /api/pdf/annotations 的区别：
 *   · 不要求 bookId，返回全部批注（跨书）
 *   · 删除需要 admin，且级联清理关联错题的裁图文件
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
  const type = String(req.query.type || '').trim();

  const where: any = {};
  if (Number.isFinite(bookId)) where.bookId = bookId;
  if (type && type !== 'all') where.type = type;

  const [data, total] = await Promise.all([
    prisma.pdfAnnotation.findMany({
      where,
      include: { book: { select: { id: true, title: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.pdfAnnotation.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
}));

router.delete('/:id', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = await prisma.pdfAnnotation.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'annotation not found' });

  // 级联清理关联错题的裁图文件（文件删除失败不阻断数据删除）
  const mistakes = await prisma.pdfMistake.findMany({
    where: { annotationId: id },
    select: { imagePath: true },
  });
  for (const m of mistakes) {
    try {
      const abs = path.resolve(getPdfRoot(), m.imagePath);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch { /* ignore */ }
  }

  await prisma.pdfAnnotation.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
