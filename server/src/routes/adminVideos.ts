import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma.js';
import { adminRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { resolveVideoPath, toRelativePath, isVideoFile } from '../services/videoMatcher.js';

const router = Router();
router.use(adminRequired);

function shape(v: any) {
  return {
    id: v.id,
    bookId: v.bookId,
    title: v.title,
    fileName: v.fileName,
    filePath: v.filePath,
    rootPath: v.rootPath,
    relPath: v.relPath,
    lessonNo: v.lessonNo,
    sortOrder: v.sortOrder,
    matchScore: v.matchScore,
    scope: v.scope,
    missing: v.missing,
    exists: fs.existsSync(v.filePath),
  };
}

/** 所有视频根目录概览：用于「换硬盘后批量重定向」 */
router.get('/roots', asyncHandler(async (_req: Request, res: Response) => {
  const videos = await prisma.bookVideo.findMany({
    select: { id: true, rootPath: true, relPath: true, filePath: true, missing: true, bookId: true },
  });
  const books = await prisma.book.findMany({ select: { id: true, batchId: true, title: true } });
  const batchMap = new Map(books.map((b) => [b.id, b.batchId]));

  const byRoot = new Map<string, { rootPath: string; total: number; missing: number; batches: Set<string> }>();
  for (const v of videos) {
    const entry = byRoot.get(v.rootPath) || { rootPath: v.rootPath, total: 0, missing: 0, batches: new Set<string>() };
    entry.total++;
    if (v.missing || !fs.existsSync(v.filePath)) entry.missing++;
    const batch = batchMap.get(v.bookId);
    if (batch) entry.batches.add(batch);
    byRoot.set(v.rootPath, entry);
  }

  res.json({
    data: [...byRoot.values()]
      .map((e) => ({ ...e, batches: [...e.batches].sort() }))
      .sort((a, b) => b.total - a.total),
  });
}));

/**
 * 批量重定向根目录（资源整盘搬到别的盘符/目录后使用）。
 * 支持按 rootPath 或 batchId 定位，只改根目录，子目录结构保持不变。
 */
router.post('/repoint', asyncHandler(async (req: Request, res: Response) => {
  const newRootRaw = typeof req.body?.newRoot === 'string' ? req.body.newRoot.trim() : '';
  const oldRoot = typeof req.body?.rootPath === 'string' ? req.body.rootPath.trim() : '';
  const batchId = typeof req.body?.batchId === 'string' ? req.body.batchId.trim() : '';
  if (!newRootRaw) {
    res.status(400).json({ error: '新根目录不能为空' });
    return;
  }
  if (!oldRoot && !batchId) {
    res.status(400).json({ error: '需要提供原根目录或批次号' });
    return;
  }

  const newRoot = path.resolve(newRootRaw);
  if (!fs.existsSync(newRoot)) {
    res.status(400).json({ error: `新根目录不存在: ${newRoot}` });
    return;
  }

  const where: any = {};
  if (oldRoot) where.rootPath = oldRoot;
  if (batchId) where.book = { batchId };

  const videos = await prisma.bookVideo.findMany({
    where,
    select: { id: true, rootPath: true, relPath: true },
  });

  let updated = 0;
  let stillMissing = 0;
  for (const v of videos) {
    const filePath = resolveVideoPath(newRoot, v.relPath);
    const missing = !fs.existsSync(filePath);
    if (missing) stillMissing++;
    await prisma.bookVideo.update({
      where: { id: v.id },
      data: { rootPath: newRoot, filePath, missing },
    });
    updated++;
  }

  res.json({ data: { updated, stillMissing, newRoot } });
}));

/** 全量复查文件是否还在原位 */
router.post('/recheck', asyncHandler(async (_req: Request, res: Response) => {
  const videos = await prisma.bookVideo.findMany({ select: { id: true, filePath: true, missing: true } });
  let missing = 0;
  let recovered = 0;
  for (const v of videos) {
    const exists = fs.existsSync(v.filePath);
    if (!exists && !v.missing) {
      await prisma.bookVideo.update({ where: { id: v.id }, data: { missing: true } });
      missing++;
    } else if (exists && v.missing) {
      await prisma.bookVideo.update({ where: { id: v.id }, data: { missing: false } });
      recovered++;
    }
  }
  res.json({ data: { total: videos.length, missing, recovered } });
}));

/** 某本书的视频列表 */
router.get('/books/:id/videos', asyncHandler(async (req: Request, res: Response) => {
  const bookId = parseInt(req.params.id, 10);
  const rows = await prisma.bookVideo.findMany({
    where: { bookId },
    orderBy: [{ sortOrder: 'asc' }, { lessonNo: 'asc' }, { id: 'asc' }],
  });
  res.json({ data: rows.map(shape) });
}));

/** 给某本书追加视频（rootPath 为空时用视频自身所在目录的上级扫描根） */
router.post('/books/:id/videos', asyncHandler(async (req: Request, res: Response) => {
  const bookId = parseInt(req.params.id, 10);
  const filePaths: string[] = Array.isArray(req.body?.filePaths) ? req.body.filePaths : [];
  const rootPathRaw = typeof req.body?.rootPath === 'string' ? req.body.rootPath.trim() : '';
  const scope = req.body?.scope === 'course' ? 'course' : 'lesson';

  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
  if (!book) {
    res.status(404).json({ error: '书籍不存在' });
    return;
  }

  const rootPath = rootPathRaw ? path.resolve(rootPathRaw) : '';
  const existing = await prisma.bookVideo.findMany({ where: { bookId }, select: { filePath: true } });
  const existingSet = new Set(existing.map((e) => e.filePath));

  let added = 0;
  let order = existing.length;
  for (const raw of filePaths) {
    const filePath = path.resolve(raw);
    if (!isVideoFile(filePath) || !fs.existsSync(filePath) || existingSet.has(filePath)) continue;
    const relPath = rootPath ? toRelativePath(rootPath, filePath) : '';
    await prisma.bookVideo.create({
      data: {
        bookId,
        title: path.basename(filePath, path.extname(filePath)),
        fileName: path.basename(filePath),
        filePath,
        rootPath: rootPath || path.dirname(filePath),
        relPath: relPath || path.basename(filePath),
        scope,
        sortOrder: order++,
      },
    });
    added++;
  }
  res.json({ data: { added } });
}));

router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const data: any = {};
  if (typeof req.body?.title === 'string') data.title = req.body.title.trim();
  if (typeof req.body?.lessonNo === 'number' || req.body?.lessonNo === null) data.lessonNo = req.body.lessonNo;
  if (typeof req.body?.sortOrder === 'number') data.sortOrder = req.body.sortOrder;
  if (req.body?.scope === 'lesson' || req.body?.scope === 'course') data.scope = req.body.scope;
  if (typeof req.body?.filePath === 'string' && req.body.filePath.trim()) {
    const filePath = path.resolve(req.body.filePath.trim());
    data.filePath = filePath;
    data.missing = !fs.existsSync(filePath);
    const current = await prisma.bookVideo.findUnique({ where: { id }, select: { rootPath: true } });
    if (current?.rootPath) data.relPath = toRelativePath(current.rootPath, filePath) || data.relPath;
  }
  const updated = await prisma.bookVideo.update({ where: { id }, data });
  res.json({ data: shape(updated) });
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  await prisma.bookVideo.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
