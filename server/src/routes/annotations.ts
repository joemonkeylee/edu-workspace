import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import prisma from '../prisma.js';

const router = Router();

const STORAGE_ABS = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.post('/', upload.single('image'), async (req: Request, res: Response) => {
  const { bookId, pageNumber, type, contentJson, tags } = req.body;

  if (!bookId || !pageNumber || !type) {
    return res.status(400).json({ error: '缺少必要参数: bookId, pageNumber, type' });
  }

  const annotation = await prisma.annotation.create({
    data: {
      bookId: parseInt(bookId, 10),
      pageNumber: parseInt(pageNumber, 10),
      type,
      contentJson: contentJson ? JSON.parse(contentJson) : {},
      tags: tags || null,
    },
  });

  if (type === 'crop' && req.file) {
    const cropDir = path.join(STORAGE_ABS, 'crops', String(bookId));
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
      },
    });
    return res.json({ annotation, mistake });
  }

  res.json({ annotation });
});

router.get('/book/:bookId', async (req: Request, res: Response) => {
  const bookId = parseInt(req.params.bookId, 10);
  const annotations = await prisma.annotation.findMany({
    where: { bookId },
    orderBy: { pageNumber: 'asc' },
  });
  res.json(annotations);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    await prisma.annotation.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '批注不存在' });
  }
});

export default router;
