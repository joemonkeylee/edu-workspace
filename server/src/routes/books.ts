import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../prisma.js';
import { getBestDpiPath, getAvailableDpisAsync } from '../services/pdfProcessor.js';
import { getBookRoot, getCropsRoot } from '../services/storage.js';
import { bookReadiness, loadProgressMap, progressFraction, toProgressInfo } from '../services/videoProgress.js';
import {
  getBookIndex,
  invalidateBookIndex,
  buildPairSummary,
  warmBookIndex,
  type BookIndex,
} from '../services/bookIndex.js';
import { authRequired, adminRequired, optionalAuth, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// 启动时后台预热全局书籍索引（答案页集合 / 配对关系 / 标题映射 / 类型计数）
warmBookIndex();

/** 把 groupBy 出来的「学科 × 学期 × 分类」组合汇总成筛选项（比拉全表轻得多） */
function buildFilterOptions(
  rows: Array<{ subject: string | null; grade: string | null; category: string | null; _count: { _all: number } }>,
) {
  const subjectSet = new Set<string>();
  const gradeSet = new Set<string>();
  const categoryCountMap = new Map<string, number>();
  for (const r of rows) {
    if (r.subject) subjectSet.add(r.subject);
    if (r.grade) gradeSet.add(r.grade);
    if (r.category) categoryCountMap.set(r.category, (categoryCountMap.get(r.category) ?? 0) + r._count._all);
  }
  const categories = [...categoryCountMap.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { subjects: [...subjectSet], grades: [...gradeSet], categories };
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

  // 全局索引（缓存）：答案页集合、配对关系、标题映射、资源类型计数
  const [index, favoriteRows] = await Promise.all([
    getBookIndex(),
    prisma.bookFavorite.findMany({
      where: { userId },
      select: { bookId: true, createdAt: true },
    }),
  ]);
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
  // 答案页书籍不进列表；判断依据来自缓存索引，因此这里可以交给数据库过滤 / 分页，
  // 不必再把全表 attributes 拉回来在内存里筛（这是过去慢的主因）
  let idFilter: { in?: number[]; notIn?: number[] };
  if (hasPairsOnly) {
    // 「只看有答案配对」= 只留教材锚点。锚点必然不是答案页，所以不必再叠加 notIn（SQL 更短）
    const anchors = index.partnerAnchorIds;
    idFilter = { in: favoritesOnly ? anchors.filter((id) => favoriteIdSet.has(id)) : anchors };
  } else {
    idFilter = { notIn: index.answerSideIds };
    if (favoritesOnly) idFilter.in = [...favoriteIdSet];
  }
  where.id = idFilter;

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

  const start = (page - 1) * pageSize;

  // 筛选项统计：一次 groupBy 出「学科 × 学期 × 分类」组合后在内存汇总，
  // 替代过去「先拉全表再 distinct/计数」的做法
  const optionsPromise = prisma.book.groupBy({
    by: ['subject', 'grade', 'category'],
    where,
    _count: { _all: true },
  });

  let total: number;
  let pageIds: number[];
  let optionRows: Awaited<typeof optionsPromise>;

  if (favoriteAtSort) {
    // 收藏时间来自关联表，无法交给数据库排序：只取 id 再在内存里排（id 很轻）
    const [allIds, opts] = await Promise.all([
      prisma.book.findMany({ where, select: { id: true } }),
      optionsPromise,
    ]);
    optionRows = opts;
    total = allIds.length;
    const dir = favoriteAtSort;
    pageIds = allIds
      .map((r) => r.id)
      .sort((a, b) => {
        const ta = favoriteTimeMap.get(a) ?? 0;
        const tb = favoriteTimeMap.get(b) ?? 0;
        return dir === 'asc' ? ta - tb : tb - ta;
      })
      .slice(start, start + pageSize);
  } else {
    // 常规路径：计数、分页、选项统计三个查询并发发出，只回传当前页所需的数据
    const [count, pageRows, opts] = await Promise.all([
      prisma.book.count({ where }),
      prisma.book.findMany({ where, orderBy, skip: start, take: pageSize, select: { id: true } }),
      optionsPromise,
    ]);
    optionRows = opts;
    total = count;
    pageIds = pageRows.map((r) => r.id);
  }

  const { subjects, grades, categories } = buildFilterOptions(optionRows);

  // 只取当前页的完整字段（含 attributes，用于 pairSummary）
  const pageBooksRaw = await prisma.book.findMany({
    where: { id: { in: pageIds } },
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
  const byId = new Map(pageBooksRaw.map((b) => [b.id, b]));
  const pageBooks = pageIds.map((id) => byId.get(id)!).filter(Boolean);

  // Attach isFavorite, availableDpis, pairSummary, videoCount — strip raw attributes from response
  const videoMeta = await buildBookVideoMeta(pageIds, req.user);
  const booksWithMeta = await Promise.all(
    pageBooks.map(async (b) => {
      const bookDir = getBookRoot(b.id);
      const dpis = await getAvailableDpisAsync(bookDir);
      const pairSummary = buildPairSummary(b.attributes, b.id, index);
      const { attributes, ...rest } = b;
      return {
        ...rest,
        isFavorite: favoriteIdSet.has(b.id),
        availableDpis: dpis,
        pairSummary: pairSummary.role ? pairSummary : null,
        videoCount: videoMeta.counts.get(b.id) || 0,
        videoProgress: videoMeta.progress.get(b.id) || null,
      };
    })
  );

  // 全库资源类型计数 —— Tab 角标，不受当前筛选影响，随索引缓存
  res.json({ data: booksWithMeta, total, page, pageSize, options: { subjects, grades, categories, kindCounts: index.kindCounts } });
}));

export interface BookVideoProgress {
  total: number;
  /** 手动标记完成的数量 */
  done: number;
  /** 已看完（未手动完成）的数量 */
  watched: number;
  /** 整本书的完成度 0-100（各视频完成度的均值） */
  percent: number;
}

interface BookVideoMeta {
  /** 可用（未缺失）讲解视频数量 */
  counts: Map<number, number>;
  progress: Map<number, BookVideoProgress>;
}

/**
 * 一次拿到「每本书的可用视频数」与「学习进度」。
 *
 * 这两样以前各查一遍 bookVideo（同样的 where、同样的 id 列表），现在共用一次查询；
 * 进度 = 该书关联的多个视频的完成度均值（同一个视频被多本书引用时进度共享）。
 */
async function buildBookVideoMeta(
  bookIds: number[],
  user?: AuthedRequest['user'],
): Promise<BookVideoMeta> {
  const counts = new Map<number, number>();
  const progress = new Map<number, BookVideoProgress>();
  if (bookIds.length === 0) return { counts, progress };

  const rows = await prisma.bookVideo.findMany({
    where: { bookId: { in: bookIds }, missing: false },
    select: { bookId: true, relPath: true },
  });
  const progressMap = await loadProgressMap(rows.map((r) => r.relPath), user);

  const acc = new Map<number, { done: number; watched: number; frac: number }>();
  for (const row of rows) {
    counts.set(row.bookId, (counts.get(row.bookId) ?? 0) + 1);
    const entry = acc.get(row.bookId) ?? { done: 0, watched: 0, frac: 0 };
    const p = progressMap.get(row.relPath) ?? null;
    entry.frac += progressFraction(p);
    if (p?.completed) entry.done += 1;
    else if (p?.watched) entry.watched += 1;
    acc.set(row.bookId, entry);
  }

  for (const [bookId, entry] of acc) {
    const total = counts.get(bookId) ?? 0;
    progress.set(bookId, {
      total,
      done: entry.done,
      watched: entry.watched,
      percent: total > 0 ? Math.round((entry.frac / total) * 100) : 0,
    });
  }
  return { counts, progress };
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
  const pairSummary = buildPairSummary(book.attributes, id, await getBookIndex());
  const videoCount = (await buildBookVideoMeta([id])).counts.get(id) || 0;
  res.json({ data: { ...book, annotations, storagePath, availableDpis: dpis, pdfFileName, pdfUrl, pairSummary: pairSummary.role ? pairSummary : null, videoCount } });
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
    invalidateBookIndex();
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
    invalidateBookIndex();
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
