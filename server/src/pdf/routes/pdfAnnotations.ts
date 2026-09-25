import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import prisma from '../../prisma.js';
import { authRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ensurePdfDirs, getPdfCropsRoot, getPdfRoot } from '../services/pdfStorage.js';

/**
 * PDF 域的批注 / 错题路由（/api/pdf/annotations、/api/pdf/mistakes）。
 *
 * 与既有 /api/annotations 契约一致，但全部写入 pdf_* 表。
 *
 * ⚠️ 裁图不走既有的 /storage/crops 静态挂载：那个中间件的鉴权是按 bookId 去
 * 查旧 Mistake 表，而 pdf_book.id 与 book.id 是两条独立自增序列，数值会撞 ——
 * 沿用会导致错判（要么 403 要么误放行）。这里改由
 * GET /api/pdf/mistakes/:id/image 按需直出，鉴权在同一个请求里完成。
 */
const router = Router();
router.use(authRequired);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function parseIntParam(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function getUserId(req: AuthedRequest): number | null {
  return typeof req.user?.userId === 'number' ? req.user.userId : null;
}

/** imagePath → 可访问的 URL */
function imageUrlOf(mistakeId: number) {
  return `/api/pdf/mistakes/${mistakeId}/image`;
}

/** Mistake 同时给出旧约定的 imagePath 与实际可直接访问的 imageUrl */
function shapeMistake(m: any) {
  const { book, annotation, ...rest } = m;
  return { ...rest, imageUrl: imageUrlOf(m.id) };
}

// ─────────────────────────────────────────────────────────────
// 批注
// ─────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseIntParam(req.query.bookId, NaN);
  if (!Number.isFinite(bookId)) return res.status(400).json({ error: 'bookId required' });

  const userId = getUserId(req);
  const couldViewOthers = Boolean(req.user?.isAdmin || req.user?.roles?.includes('teacher'));
  const where: any = { bookId };
  if (userId && !couldViewOthers) where.userId = userId;

  const rows = await prisma.pdfAnnotation.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: { mistakes: true },
  });

  res.json({ data: rows.map((a: any) => ({ ...a, mistakes: a.mistakes.map(shapeMistake) })) });
}));

/** 新建批注。type=crop 时附带裁图，并同步生成一条错题。 */
router.post('/', upload.single('image'), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { bookId, pageNumber, type, contentJson, tags, subject } = req.body || {};
  if (!bookId || !pageNumber || !type) {
    return res.status(400).json({ error: '缺少必要参数: bookId, pageNumber, type' });
  }

  const bid = parseIntParam(bookId, NaN);
  const pno = parseIntParam(pageNumber, NaN);
  if (!Number.isFinite(bid) || !Number.isFinite(pno)) {
    return res.status(400).json({ error: 'bookId / pageNumber 必须是数字' });
  }

  const book = await prisma.pdfBook.findFirst({ where: { id: bid, isDeleted: false }, select: { id: true, subject: true } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const userId = getUserId(req);
  const annotation = await prisma.pdfAnnotation.create({
    data: {
      bookId: bid,
      pageNumber: pno,
      type: String(type),
      contentJson: contentJson ? JSON.parse(String(contentJson)) : {},
      tags: tags ? String(tags) : null,
      userId,
    },
  });

  let mistake: any = null;
  if (String(type) === 'crop' && req.file) {
    ensurePdfDirs();
    const cropDir = path.join(getPdfCropsRoot(), String(bid));
    fs.mkdirSync(cropDir, { recursive: true });
    const ext = path.extname(req.file.originalname) || '.png';
    const fileName = `${uuidv4()}${ext}`;
    const absPath = path.join(cropDir, fileName);
    fs.writeFileSync(absPath, req.file.buffer);

    mistake = await prisma.pdfMistake.create({
      data: {
        annotationId: annotation.id,
        bookId: bid,
        pageNumber: pno,
        // 相对 pdf root 的路径（而非相对 cwd），随根目录迁移仍然可定位
        imagePath: path.posix.join('crops', String(bid), fileName),
        subject: subject ? String(subject) : (book.subject || ''),
        tags: tags ? String(tags) : null,
        userId,
      },
    });
  }

  res.json({ data: { annotation, mistake: mistake ? shapeMistake(mistake) : null } });
}));

router.patch('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = await prisma.pdfAnnotation.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'annotation not found' });

  const userId = getUserId(req);
  if (userId && existing.userId !== userId && !req.user?.isAdmin && !req.user?.roles?.includes('teacher')) {
    return res.status(403).json({ error: 'no permission' });
  }

  const data: any = {};
  if (typeof req.body?.tags === 'string') data.tags = req.body.tags;
  if (req.body?.contentJson !== undefined) data.contentJson = req.body.contentJson;

  const updated = await prisma.pdfAnnotation.update({ where: { id }, data });
  res.json({ data: updated });
}));

router.delete('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const existing = await prisma.pdfAnnotation.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'annotation not found' });

  const userId = getUserId(req);
  if (userId && existing.userId !== userId && !req.user?.isAdmin && !req.user?.roles?.includes('teacher')) {
    return res.status(403).json({ error: 'no permission' });
  }

  // 文件删除失败绝不能阻断数据删除（与既有约定一致）
  const mistakes = await prisma.pdfMistake.findMany({ where: { annotationId: id }, select: { imagePath: true } });
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
