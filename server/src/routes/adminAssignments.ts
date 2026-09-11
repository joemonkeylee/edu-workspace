import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';
import { teacherOrAdminRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(teacherOrAdminRequired);

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string) || 20));
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  const bookId = parseInt(req.query.bookId as string);

  const where: any = {};
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { subject: { contains: search } },
      { book: { title: { contains: search } } },
    ];
  }
  if (status !== 'all') where.status = status;
  if (!Number.isNaN(bookId)) where.bookId = bookId;

  const [data, total, books] = await Promise.all([
    prisma.assignment.findMany({
      where,
      include: {
        book: { select: { id: true, title: true } },
        _count: { select: { strokes: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.assignment.count({ where }),
    prisma.book.findMany({
      where: { assignments: { some: {} } },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    }),
  ]);

  res.json({ data, total, page, pageSize, books });
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  await prisma.$transaction([
    prisma.assignmentStroke.deleteMany({ where: { assignmentId: id } }),
    prisma.assignment.delete({ where: { id } }),
  ]);
  res.json({ success: true });
}));

router.post('/batch-delete', asyncHandler(async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
    : [];
  if (ids.length === 0) return res.status(400).json({ error: '请选择作业' });
  const result = await prisma.$transaction(async (tx) => {
    await tx.assignmentStroke.deleteMany({ where: { assignmentId: { in: ids } } });
    return tx.assignment.deleteMany({ where: { id: { in: ids } } });
  });
  res.json({ success: true, count: result.count });
}));

export default router;
