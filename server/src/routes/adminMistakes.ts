import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';
import { getStorageRoot } from '../services/storage.js';
import { teacherOrAdminRequired, adminRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(teacherOrAdminRequired);

router.get('/', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 20;
  const subject = req.query.subject as string;
  const reviewStatus = req.query.reviewStatus as string;
  const tag = req.query.tag as string;

  const where: any = {};
  if (subject && subject !== 'all') where.subject = subject;
  if (reviewStatus !== undefined && reviewStatus !== 'all') {
    where.reviewStatus = Number(reviewStatus);
  }
  if (tag) where.tags = { contains: tag };

  // Admin sees all; teacher sees only their own mistakes
  if (req.user && !req.user.isAdmin && req.user.role === 'teacher') {
    where.userId = req.user.userId;
  }

  const [data, total] = await Promise.all([
    prisma.mistake.findMany({
      where,
      include: { book: { select: { title: true, category: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.mistake.count({ where }),
  ]);

  res.json({ data, total, page, pageSize });
}));

// Only admin can modify/delete mistakes in admin panel
router.put('/:id', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { reviewStatus, tags, subject } = req.body;
  const data: any = {};
  if (reviewStatus !== undefined) data.reviewStatus = reviewStatus;
  if (tags !== undefined) data.tags = tags;
  if (subject !== undefined) data.subject = subject;

  const updated = await prisma.mistake.update({ where: { id }, data });
  res.json({ data: updated });
}));

router.delete('/:id', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const mistake = await prisma.mistake.findUnique({ where: { id } });
  if (mistake?.imagePath) {
    const filePath = path.join(getStorageRoot(), mistake.imagePath.replace('/storage/', ''));
    try { fs.rmSync(filePath, { force: true }); } catch { /* file may not exist */ }
  }
  await prisma.mistake.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
