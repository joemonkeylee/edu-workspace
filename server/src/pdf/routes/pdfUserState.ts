import { Router, Response } from 'express';
import prisma from '../../prisma.js';
import { authRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * PDF 模块的用户态数据：收藏 + 阅读进度。
 *
 * standalone 模式（AUTH_ENABLED=false）下 req.user 为空，userId 以 NULL 落库。
 * ⚠️ MySQL 的唯一索引允许多条 NULL，所以这里不能用 upsert —— 否则重复点击会
 * 不断插入新行且 findFirst 永远返回第一条。统一走「findFirst 后 update/create」。
 */
const router = Router();
router.use(authRequired);

function getUserId(req: AuthedRequest): number | null {
  return typeof req.user?.userId === 'number' ? req.user.userId : null;
}

function parseIntParam(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

const EMPTY_PROGRESS = {
  pageNumber: 1,
  pageLayout: 'single',
  fitMode: 'page',
  scale: 1.5,
  rotation: 0,
};

// ─────────────────────────────────────────────────────────────
// 收藏
// ─────────────────────────────────────────────────────────────

/** 当前用户收藏的全部 pdf_book id */
router.get('/favorites', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const userId = getUserId(req);
  const rows = await prisma.pdfBookFavorite.findMany({
    where: { userId },
    select: { bookId: true, createdAt: true },
  });
  res.json({ data: rows });
}));

/** 切换收藏状态，返回切换后的结果 */
router.post('/favorites/:bookId', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseIntParam(req.params.bookId, NaN);
  if (!Number.isFinite(bookId)) return res.status(400).json({ error: 'invalid bookId' });

  const book = await prisma.pdfBook.findFirst({
    where: { id: bookId, isDeleted: false },
    select: { id: true },
  });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const userId = getUserId(req);
  const existing = await prisma.pdfBookFavorite.findFirst({ where: { userId, bookId } });

  if (existing) {
    // 连带清理可能遗留的重复行（唯一索引对 NULL 无效时会攒出多条）
    await prisma.pdfBookFavorite.deleteMany({ where: { userId, bookId } });
    return res.json({ data: { bookId, favorited: false } });
  }

  const row = await prisma.pdfBookFavorite.create({ data: { userId, bookId } });
  res.json({ data: { bookId, favorited: true, favoriteAt: row.createdAt } });
}));

// ─────────────────────────────────────────────────────────────
// 阅读进度
// ─────────────────────────────────────────────────────────────

router.get('/reading-progress/:bookId', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseIntParam(req.params.bookId, NaN);
  if (!Number.isFinite(bookId)) return res.status(400).json({ error: 'invalid bookId' });

  const userId = getUserId(req);
  const row = await prisma.pdfReadingProgress.findFirst({ where: { userId, bookId } });
  res.json({ data: row ?? { ...EMPTY_PROGRESS, bookId } });
}));

router.put('/reading-progress/:bookId', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseIntParam(req.params.bookId, NaN);
  if (!Number.isFinite(bookId)) return res.status(400).json({ error: 'invalid bookId' });

  const body = req.body || {};
  const data: any = {};
  if (typeof body.pageNumber === 'number' && body.pageNumber > 0) data.pageNumber = body.pageNumber;
  if (body.pageLayout === 'single' || body.pageLayout === 'double') data.pageLayout = body.pageLayout;
  if (body.fitMode === 'page' || body.fitMode === 'width') data.fitMode = body.fitMode;
  if (typeof body.scale === 'number' && body.scale > 0) data.scale = body.scale;
  if (typeof body.rotation === 'number') data.rotation = ((body.rotation % 360) + 360) % 360;

  if (!Object.keys(data).length) return res.status(400).json({ error: 'no fields to update' });

  const userId = getUserId(req);
  const existing = await prisma.pdfReadingProgress.findFirst({ where: { userId, bookId } });
  const row = existing
    ? await prisma.pdfReadingProgress.update({ where: { id: existing.id }, data })
    : await prisma.pdfReadingProgress.create({ data: { userId, bookId, ...data } });

  res.json({ data: row });
}));

export default router;
