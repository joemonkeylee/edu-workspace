import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
const PAGE_SIZE = 20;

router.get('/', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { subject, reviewStatus, bookId, tag, page: pageStr, pageSize: pageSizeStr } = req.query;
  const userId = req.user?.userId;
  const where: any = {};
  if (subject) where.subject = subject;
  if (reviewStatus !== undefined) where.reviewStatus = parseInt(reviewStatus as string, 10);
  if (bookId) where.bookId = parseInt(bookId as string, 10);
  if (tag) where.tags = { contains: tag as string };
  if (userId) {
    where.OR = [{ userId }, { userId: null }];
  }

  const page = parseInt(pageStr as string, 10) || 1;
  const pageSize = parseInt(pageSizeStr as string, 10) || PAGE_SIZE;
  const skip = (page - 1) * pageSize;

  const [mistakes, total] = await Promise.all([
    prisma.mistake.findMany({
      where,
      include: { book: { select: { title: true, category: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.mistake.count({ where }),
  ]);
  res.json({ data: mistakes, total, page, pageSize });
}));

router.patch('/:id', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { reviewStatus, tags, subject } = req.body;
  const data: any = {};
  if (reviewStatus !== undefined) data.reviewStatus = reviewStatus;
  if (tags !== undefined) data.tags = tags;
  if (subject !== undefined) data.subject = subject;

  try {
    const mistake = await prisma.mistake.findUnique({ where: { id } });
    if (!mistake) return res.status(404).json({ error: '错题不存在' });
    if (req.user && mistake.userId !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ error: '没有权限修改此错题' });
    }
    const updated = await prisma.mistake.update({ where: { id }, data });
    res.json({ data: updated });
  } catch {
    res.status(404).json({ error: '错题不存在' });
  }
}));

router.delete('/:id', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const mistake = await prisma.mistake.findUnique({ where: { id } });
    if (!mistake) return res.status(404).json({ error: '错题不存在' });
    if (req.user && mistake.userId !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ error: '没有权限删除此错题' });
    }
    await prisma.mistake.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '错题不存在' });
  }
}));

export default router;
