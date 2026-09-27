import { Router, Response } from 'express';
import prisma from '../../prisma.js';
import { teacherOrAdminRequired, adminRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * PDF 原生作业管理端路由（/api/pdf/admin/assignments）。
 *
 * 与用户态 /api/pdf/assignments 的区别：
 *   · 不要求 bookId，返回全部作业（跨书）
 *   · 支持 search / status / bookId 筛选
 *   · 删除 / 批量删除需要 admin
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
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const bookId = parseIntParam(req.query.bookId, NaN);

  const where: any = {};
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { subject: { contains: search } },
      { book: { title: { contains: search } } },
    ];
  }
  // 「有问题」不是状态而是已批改作业上的结论
  if (status === 'issue') {
    where.status = 'graded';
    where.gradeResult = 'issue';
  } else if (status && status !== 'all') {
    where.status = status;
  }
  if (Number.isFinite(bookId)) where.bookId = bookId;

  const [data, total, books] = await Promise.all([
    prisma.pdfAssignment.findMany({
      where,
      include: {
        book: { select: { id: true, title: true } },
        _count: { select: { strokes: true } },
        strokes: { select: { pageNumber: true }, distinct: ['pageNumber'], orderBy: { pageNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pdfAssignment.count({ where }),
    prisma.pdfBook.findMany({
      where: { assignments: { some: {} } },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    }),
  ]);

  const rows = data.map(({ strokes, ...rest }: any) => ({
    ...rest,
    pages: strokes.map((s: any) => s.pageNumber),
  }));

  res.json({ data: rows, total, page, pageSize, books });
}));

router.delete('/:id', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  await prisma.$transaction([
    prisma.pdfAssignmentStroke.deleteMany({ where: { assignmentId: id } }),
    prisma.pdfAssignment.delete({ where: { id } }),
  ]);
  res.json({ success: true });
}));

router.post('/batch-delete', adminRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) return res.status(400).json({ error: '请选择作业' });

  const result = await prisma.$transaction(async (tx) => {
    await tx.pdfAssignmentStroke.deleteMany({ where: { assignmentId: { in: ids } } });
    return tx.pdfAssignment.deleteMany({ where: { id: { in: ids } } });
  });
  res.json({ success: true, count: result.count });
}));

export default router;
