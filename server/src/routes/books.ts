import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';
import { getBestDpiPath, getAvailableDpisAsync } from '../services/pdfProcessor.js';
import { getBookRoot, getCropsRoot } from '../services/storage.js';
import { bookReadiness, loadProgressMap, progressFraction, toProgressInfo } from '../services/videoProgress.js';
import { authRequired, adminRequired, optionalAuth, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// ── Helpers: pair summary (used by list + detail endpoints) ──────────

interface PairEntry { with: number; role: 'textbook' | 'answer'; boundAt: string }

function getPairs(attrs: any): PairEntry[] {
  if (!attrs) return [];
  if (Array.isArray(attrs.pairs)) return attrs.pairs;
  if (attrs.pair && typeof attrs.pair === 'object') return [attrs.pair];
  return [];
}

/** True if this book declares itself as a textbook anchor (self-pair with role='textbook'). */
function isTextbookAnchor(attrs: any, bookId: number): boolean {
  return getPairs(attrs).some((p) => p.role === 'textbook' && p.with === bookId);
}

/** True if this book only has outward 'answer' pair entries (it is an answer-side companion). */
function isAnswerSide(attrs: any, bookId: number): boolean {
  const pairs = getPairs(attrs);
  if (pairs.length === 0) return false;
  return !pairs.some((p) => p.role === 'textbook' && p.with === bookId)
    && pairs.some((p) => p.role === 'answer');
}

interface AnswerLite { id: number; title: string }

/**
 * Build a reverse index across ALL books in the system: textbookAnchorId → list of answer books.
 * This is needed because the textbook's own attributes only contain its self-anchor marker;
 * answer-partner references live on the answer side (answer.attrs.pair.with = textbookId).
 */
async function buildReversePairIndex(): Promise<Map<number, AnswerLite[]>> {
  const all = await prisma.book.findMany({
    select: { id: true, title: true, attributes: true },
  });
  const idx = new Map<number, AnswerLite[]>();
  for (const b of all) {
    const pairs = getPairs(b.attributes);
    for (const p of pairs) {
      if (p.role === 'answer' && p.with !== b.id) {
        const arr = idx.get(p.with) ?? [];
        arr.push({ id: b.id, title: b.title });
        idx.set(p.with, arr);
      }
    }
  }
  return idx;
}

interface PairSummary {
  role: 'textbook' | 'answer' | null;
  partnerCount: number;
  partners: Array<{ id: number; title: string }>;
}

function buildPairSummary(
  attrs: any,
  bookId: number,
  tbToAnswers: Map<number, AnswerLite[]>,
  idToTitle: Map<number, string>,
): PairSummary {
  const pairs = getPairs(attrs);
  if (pairs.length === 0) return { role: null, partnerCount: 0, partners: [] };

  if (isTextbookAnchor(attrs, bookId)) {
    const partners = tbToAnswers.get(bookId) ?? [];
    return { role: 'textbook', partnerCount: partners.length, partners };
  }

  if (isAnswerSide(attrs, bookId)) {
    // Collect textbook anchor(s) this answer belongs to (from its own pair entries)
    const partners: Array<{ id: number; title: string }> = [];
    const seen = new Set<number>();
    for (const p of pairs) {
      if (p.role !== 'answer' || p.with === bookId || seen.has(p.with)) continue;
      seen.add(p.with);
      partners.push({ id: p.with, title: idToTitle.get(p.with) ?? `Book #${p.with}` });
    }
    return { role: 'answer', partnerCount: partners.length, partners };
  }

  return { role: null, partnerCount: 0, partners: [] };
}

router.get('/', optionalAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const category = req.query.category as string;
  const grade = req.query.grade as string;
  const subject = req.query.subject as string;
  const search = req.query.search as string;
  const sort = req.query.sort as string; // e.g. "subject:asc,grade:desc,title:asc"
  const page = parseInt(req.query.page as string, 10) || 1;
  const pageSize = parseInt(req.query.pageSize as string, 10) || 16;
  const favoritesOnly = req.query.favoritesOnly === 'true';
  const hasPairsOnly = req.query.hasPairs === 'true';
  // 资源类型：book = 普通书籍，course = 带讲解视频的课程资源；不传/all 表示不过滤
  const kind = req.query.kind as string;
  // 只看当前确实关联了视频的书（换盘后视频缺失的会被排除）
  const hasVideoOnly = req.query.hasVideo === 'true';

  // Current user (null in standalone mode → global favorites)
  const userId = req.user?.userId ?? null;

  // Resolve favorite book IDs + added time for the current user
  // (used for isFavorite flag, favoritesOnly filter, and favorite-time sorting)
  const favoriteRows = await prisma.bookFavorite.findMany({
    where: { userId },
    select: { bookId: true, createdAt: true },
  });
  const favoriteIdSet = new Set(favoriteRows.map((r) => r.bookId));
  const favoriteTimeMap = new Map<number, number>(
    favoriteRows.map((r) => [r.bookId, r.createdAt.getTime()])
  );

  const where: any = { isDeleted: false };
  if (category && category !== 'all') where.category = category;
  if (grade && grade !== 'all') where.grade = grade;
  if (subject && subject !== 'all') where.subject = subject;
  if (kind === 'book' || kind === 'course') where.kind = kind;
  if (hasVideoOnly) where.videos = { some: { missing: false } };
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { category: { contains: search } },
      { grade: { contains: search } },
      { subject: { contains: search } },
    ];
  }
  if (favoritesOnly) {
    where.id = { in: [...favoriteIdSet] };
  }

  // Build orderBy from sort param. `favoriteAt` is a join (BookFavorite.createdAt)
  // and is applied in-memory after filtering; book fields go directly to Prisma.
  const orderBy: any[] = [];
  let favoriteAtSort: 'asc' | 'desc' | null = null;
  if (sort) {
    for (const part of sort.split(',')) {
      const [field, dir] = part.trim().split(':');
      if (field === 'favoriteAt') {
        if (dir === 'asc' || dir === 'desc') favoriteAtSort = dir;
        continue;
      }
      if (['subject', 'grade', 'category', 'title', 'totalPages'].includes(field) && ['asc', 'desc'].includes(dir)) {
        orderBy.push({ [field]: dir });
      }
    }
  }
  if (orderBy.length === 0 && !favoriteAtSort) {
    // 只看收藏默认按「添加收藏时间」倒序；其它情况按入库时间倒序
    if (favoritesOnly) {
      favoriteAtSort = 'desc';
    } else {
      orderBy.push({ createdAt: 'desc' });
    }
  }

  // 1) Fetch ALL matching books WITH attributes so we can detect pair roles.
  //    For typical datasets (< 2000 books) in-memory filtering is fine.
  const allMatching = await prisma.book.findMany({
    where,
    orderBy,
    select: {
      id: true,
      title: true,
      category: true,
      grade: true,
      subject: true,
      kind: true,
      coverPage: true,
      totalPages: true,
      storagePath: true,
      createdAt: true,
      attributes: true,
    },
  });

  // 2) Build reverse pair index (needed for both hasPairs filter + pairSummary)
  const [tbToAnswers, idToTitleMap] = await Promise.all([
    buildReversePairIndex(),
    prisma.book.findMany({ select: { id: true, title: true } })
      .then((all) => new Map(all.map((b) => [b.id, b.title]))),
  ]);

  // 3) Filter out answer-side books + optional "has pair partners only"
  const filtered = allMatching.filter((b) => {
    if (isAnswerSide(b.attributes, b.id)) return false;
    if (hasPairsOnly) {
      // Keep only textbook anchors that have at least one answer partner
      if (!isTextbookAnchor(b.attributes, b.id)) return false;
      const partners = tbToAnswers.get(b.id) ?? [];
      if (partners.length === 0) return false;
    }
    return true;
  });

  // 按「收藏时间」排序（只看收藏默认即如此，也可由 sort=favoriteAt 显式指定）
  if (favoriteAtSort) {
    filtered.sort((a, b) => {
      const ta = favoriteTimeMap.get(a.id) ?? 0;
      const tb = favoriteTimeMap.get(b.id) ?? 0;
      return favoriteAtSort === 'asc' ? ta - tb : tb - ta;
    });
  }

  // 4) Filter options from the cleaned list (counts stay consistent with displayed books)
  const subjects = [...new Set(filtered.map((b) => b.subject).filter(Boolean))] as string[];
  const grades = [...new Set(filtered.map((b) => b.grade).filter(Boolean))] as string[];
  const categoryCountMap = new Map<string, number>();
  for (const b of filtered) {
    if (b.category) {
      categoryCountMap.set(b.category, (categoryCountMap.get(b.category) || 0) + 1);
    }
  }
  const categories = [...categoryCountMap.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 5) In-memory pagination
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageSlice = filtered.slice(start, start + pageSize);

  // 6) Attach isFavorite, availableDpis, pairSummary, videoCount — strip raw attributes from response
  const videoCountMap = await buildVideoCountMap(pageSlice.map((b) => b.id));
  const videoProgressMap = await buildVideoProgressMap(pageSlice.map((b) => b.id), req.user);
  const booksWithMeta = await Promise.all(
    pageSlice.map(async (b) => {
      const bookDir = getBookRoot(b.id);
      const dpis = await getAvailableDpisAsync(bookDir);
      const pairSummary = buildPairSummary(b.attributes, b.id, tbToAnswers, idToTitleMap);
      const { attributes, ...rest } = b;
      return {
        ...rest,
        isFavorite: favoriteIdSet.has(b.id),
        availableDpis: dpis,
        pairSummary: pairSummary.role ? pairSummary : null,
        videoCount: videoCountMap.get(b.id) || 0,
        videoProgress: videoProgressMap.get(b.id) || null,
      };
    })
  );

  // 全库资源类型计数 —— 首页「全部书籍 / 视频课程」Tab 上的角标，不受当前筛选影响
  const kindRows = await prisma.book.groupBy({
    by: ['kind'],
    where: { isDeleted: false },
    _count: { _all: true },
  });
  const kindCounts = { book: 0, course: 0 };
  for (const r of kindRows) {
    if (r.kind === 'course') kindCounts.course = r._count._all;
    else kindCounts.book += r._count._all;
  }

  res.json({ data: booksWithMeta, total, page, pageSize, options: { subjects, grades, categories, kindCounts } });
}));

/** 批量统计可用（未缺失）讲解视频数量 */
async function buildVideoCountMap(bookIds: number[]): Promise<Map<number, number>> {
  if (bookIds.length === 0) return new Map();
  const rows = await prisma.bookVideo.groupBy({
    by: ['bookId'],
    where: { bookId: { in: bookIds }, missing: false },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.bookId, r._count._all]));
}

export interface BookVideoProgress {
  total: number;
  /** 手动标记完成的数量 */
  done: number;
  /** 已看完（未手动完成）的数量 */
  watched: number;
  /** 整本书的完成度 0-100（各视频完成度的均值） */
  percent: number;
}

/**
 * 每本书的学习进度 = 它关联的多个视频的进度聚合（同一个视频被多本书引用时进度共享）。
 * 以视频为单位算出完成度，再对书内视频取均值。
 */
async function buildVideoProgressMap(
  bookIds: number[],
  user?: AuthedRequest['user'],
): Promise<Map<number, BookVideoProgress>> {
  const out = new Map<number, BookVideoProgress>();
  if (bookIds.length === 0) return out;

  const rows = await prisma.bookVideo.findMany({
    where: { bookId: { in: bookIds }, missing: false },
    select: { bookId: true, relPath: true },
  });
  const progressMap = await loadProgressMap(rows.map((r) => r.relPath), user);

  const acc = new Map<number, { total: number; done: number; watched: number; frac: number }>();
  for (const row of rows) {
    const entry = acc.get(row.bookId) ?? { total: 0, done: 0, watched: 0, frac: 0 };
    const p = progressMap.get(row.relPath) ?? null;
    entry.total += 1;
    entry.frac += progressFraction(p);
    if (p?.completed) entry.done += 1;
    else if (p?.watched) entry.watched += 1;
    acc.set(row.bookId, entry);
  }

  for (const [bookId, entry] of acc) {
    out.set(bookId, {
      total: entry.total,
      done: entry.done,
      watched: entry.watched,
      percent: entry.total > 0 ? Math.round((entry.frac / entry.total) * 100) : 0,
    });
  }
  return out;
}

// 某本书的讲解视频列表（供阅读器左侧「视频」标签使用），附带学习进度与「手动完成」就绪状态
router.get('/:id/videos', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const rows = await prisma.bookVideo.findMany({
    where: { bookId: id },
    orderBy: [{ sortOrder: 'asc' }, { lessonNo: 'asc' }, { id: 'asc' }],
  });
  const [progressMap, readiness] = await Promise.all([
    loadProgressMap(rows.map((v) => v.relPath), req.user),
    bookReadiness(id, req.user),
  ]);
  const data = rows.map((v) => ({
    id: v.id,
    title: v.title || v.fileName,
    fileName: v.fileName,
    lessonNo: v.lessonNo,
    scope: v.scope,
    matchScore: v.matchScore,
    missing: v.missing || !fs.existsSync(v.filePath),
    streamUrl: `/api/videos/${v.id}/stream`,
    progress: toProgressInfo(progressMap.get(v.relPath)),
  }));
  res.json({ data, readiness });
}));

router.get('/:id', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book || book.isDeleted) {
    return res.status(404).json({ error: '书籍不存在' });
  }
  const userId = req.user?.userId;
  const annotationWhere: any = { bookId: id };
  if (userId) {
    annotationWhere.OR = [{ userId }, { userId: null }];
  }
  const annotations = await prisma.annotation.findMany({
    where: annotationWhere,
    orderBy: { pageNumber: 'asc' },
  });
  const bookDir = getBookRoot(id);
  const best = getBestDpiPath(bookDir);
  const storagePath = best ? `/storage/books/${id}/${best.dpi}/` : book.storagePath;
  const dpis = await getAvailableDpisAsync(bookDir);
  const pdfFileName = fs.existsSync(bookDir)
    ? fs.readdirSync(bookDir).find((name) => name.toLowerCase().endsWith('.pdf')) || null
    : null;
  const pdfUrl = pdfFileName
    ? `/storage/books/${id}/${encodeURIComponent(pdfFileName)}`
    : null;
  const [tbToAnswers, idToTitleMap] = await Promise.all([
    buildReversePairIndex(),
    prisma.book.findMany({ select: { id: true, title: true } })
      .then((all) => new Map(all.map((b) => [b.id, b.title]))),
  ]);
  const pairSummary = buildPairSummary(book.attributes, id, tbToAnswers, idToTitleMap);
  const videoCountMap = await buildVideoCountMap([id]);
  res.json({ data: { ...book, annotations, storagePath, availableDpis: dpis, pdfFileName, pdfUrl, pairSummary: pairSummary.role ? pairSummary : null, videoCount: videoCountMap.get(id) || 0 } });
}));

router.delete('/:id', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const bookDir = getBookRoot(id);
    const cropDir = path.join(getCropsRoot(), String(id));
    const { rmSync } = await import('fs');
    try { rmSync(bookDir, { recursive: true, force: true }); } catch { /* files may not exist in dev */ }
    try { rmSync(cropDir, { recursive: true, force: true }); } catch { /* files may not exist in dev */ }
    await prisma.book.delete({ where: { id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
}));

router.put('/:id', adminRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const { title, category, grade, subject } = req.body;
  const data: any = {};
  if (typeof title === 'string') data.title = title;
  if (typeof category === 'string') data.category = category;
  if (typeof grade === 'string') data.grade = grade;
  if (typeof subject === 'string') data.subject = subject;
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: '没有可更新的字段' });
  }
  try {
    const updated = await prisma.book.update({ where: { id }, data });
    res.json({ data: updated });
  } catch {
    res.status(404).json({ error: '书籍不存在' });
  }
}));

// Toggle favorite for the current user (standalone mode → global, userId=null)
router.post('/:id/favorite', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid bookId' });

  const userId = req.user?.userId ?? null;

  const existing = await prisma.bookFavorite.findFirst({
    where: { userId, bookId: id },
  });

  if (existing) {
    await prisma.bookFavorite.deleteMany({ where: { userId, bookId: id } });
    return res.json({ data: { isFavorite: false } });
  }

  // delete-then-create in a transaction to avoid duplicate rows
  // (the unique constraint does not catch NULL userId in standalone mode)
  await prisma.$transaction([
    prisma.bookFavorite.deleteMany({ where: { userId, bookId: id } }),
    prisma.bookFavorite.create({ data: { userId, bookId: id } }),
  ]);
  res.json({ data: { isFavorite: true } });
}));

export default router;
