import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import prisma from '../prisma.js';
import { getCropsRoot } from '../services/storage.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.post('/', authRequired, upload.single('image'), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { bookId, pageNumber, type, contentJson, tags } = req.body;

  if (!bookId || !pageNumber || !type) {
    return res.status(400).json({ error: '缺少必要参数: bookId, pageNumber, type' });
  }

  const userId = req.user?.userId || null;
  const annotation = await prisma.annotation.create({
    data: {
      bookId: parseInt(bookId, 10),
      pageNumber: parseInt(pageNumber, 10),
      type,
      contentJson: contentJson ? JSON.parse(contentJson) : {},
      tags: tags || null,
      userId,
    },
  });

  if (type === 'crop' && req.file) {
    const cropDir = path.join(getCropsRoot(), String(bookId));
    fs.mkdirSync(cropDir, { recursive: true });
    const ext = path.extname(req.file.originalname) || '.png';
    const filename = `${uuidv4()}${ext}`;
    fs.writeFileSync(path.join(cropDir, filename), req.file.buffer);
    const imagePath = `/storage/crops/${bookId}/${filename}`;

    const mistake = await prisma.mistake.create({
      data: {
        annotationId: annotation.id,
        bookId: parseInt(bookId, 10),
        pageNumber: parseInt(pageNumber, 10),
        imagePath,
        subject: req.body.subject || '未分类',
        tags: tags || null,
        userId,
      },
    });
    return res.json({ data: { annotation, mistake } });
  }

  res.json({ data: { annotation } });
}));

router.get('/book/:bookId', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.params.bookId, 10);
  const userId = req.user?.userId;
  const where: any = { bookId };
  if (userId) {
    where.OR = [{ userId }, { userId: null }];
  }
  const annotations = await prisma.annotation.findMany({
    where,
    orderBy: { pageNumber: 'asc' },
  });
  res.json({ data: annotations });
}));

router.delete('/:id', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const annotation = await prisma.annotation.findUnique({ where: { id } });
    if (!annotation) return res.status(404).json({ error: '批注不存在' });
    if (req.user && annotation.userId !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ error: '没有权限删除此批注' });
    }

    // Clean up crops files if this is a crop annotation
    if (annotation.type === 'crop') {
      const mistakes = await prisma.mistake.findMany({
        where: { annotationId: id },
        select: { imagePath: true },
      });
      for (const m of mistakes) {
        if (m.imagePath) {
          try {
            // imagePath format: /storage/crops/{bookId}/{filename}
            // Extract relative path after /storage/ to resolve correctly
            const relPath = m.imagePath.replace(/^\/storage\//, '');
            const storageRoot = path.resolve(getCropsRoot(), '..');
            fs.rmSync(path.join(storageRoot, relPath), { force: true });
          } catch { /* file may not exist */ }
        }
      }
    }

    await prisma.annotation.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '批注不存在' });
  }
}));

export default router;
