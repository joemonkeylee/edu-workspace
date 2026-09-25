import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../prisma.js';
import { authRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { extractPageText, hashFile, inspectPdf, openPdf } from '../services/pdfMeta.js';
import { ensureCover, ensureThumb } from '../services/pdfRender.js';
import { ensurePdfDirs, getPdfRoot, getThumbPath, joinRootRel, splitRootRel } from '../services/pdfStorage.js';

const router = Router();
router.use(authRequired);

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────

interface ResolvedFile {
  ok: boolean;
  filePath: string;
  missing: boolean;
}

/**
 * 解析出 PDF 的当前绝对路径。
 * 引用式存储：rootPath 可能因换盘而失效，此时回退到 filePath，
 * 并顺带把 missing 标记同步回数据库。
 */
async function resolveBookFile(book: {
  id: number;
  rootPath: string;
  relPath: string;
  filePath: string;
  missing: boolean;
}): Promise<ResolvedFile> {
  const candidates = [
    joinRootRel(book.rootPath, book.relPath),
    book.filePath,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      if (book.missing) {
        await prisma.pdfBook.update({ where: { id: book.id }, data: { missing: false } }).catch(() => {});
      }
      return { ok: true, filePath: candidate, missing: false };
    }
  }

  if (!book.missing) {
    await prisma.pdfBook.update({ where: { id: book.id }, data: { missing: true } }).catch(() => {});
  }
  return { ok: false, filePath: candidates[0] || '', missing: true };
}

function parseIntParam(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** 只允许访问 pdf 模块自己的目录，防止路径穿越 */
function assertInsidePdfRoot(target: string) {
  const root = path.resolve(getPdfRoot());
  const resolved = path.resolve(target);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw Object.assign(new Error('path outside pdf root'), { status: 400 });
  }
}

/**
 * 带 Range 支持的 PDF 流式返回。
 * 大文件（库里有 189MB 的）必须靠 Range 才能让 pdf.js 按需拉取，
 * 否则要整包下载完才能渲染第一页。
 */
function streamFile(req: AuthedRequest, res: Response, filePath: string, contentType: string) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', 'inline');

  if (!range) {
    if (contentType === 'application/pdf') {
      // pdf.js 需要能读到总长度
      res.setHeader('Content-Length', String(total));
    }
    res.status(200);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.setHeader('Content-Range', `bytes */${total}`);
    res.status(416).end();
    return;
  }

  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : total - 1;

  if (!match[1] && match[2]) {
    // bytes=-N 表示最后 N 字节
    const suffix = parseInt(match[2], 10);
    start = Math.max(0, total - suffix);
    end = total - 1;
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
    res.setHeader('Content-Range', `bytes */${total}`);
    res.status(416).end();
    return;
  }
  end = Math.min(end, total - 1);

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  res.setHeader('Content-Length', String(end - start + 1));
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

// ─────────────────────────────────────────────────────────────
// 书籍列表 / 详情
// ─────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true, title: true, category: true, grade: true, subject: true,
  totalPages: true, coverPage: true, searchable: true, missing: true,
  pdfKind: true, fileSize: true, batchId: true, createdAt: true,
} as const;

/** 可排序字段白名单。Prisma 的 orderBy 不接受任意字符串，必须显式映射。 */
const SORTABLE = new Set([
  'title', 'totalPages', 'category', 'grade', 'subject', 'createdAt', 'updatedAt', 'id', 'favoriteAt',
]);

function parseSort(raw: unknown): { field: string; dir: 'asc' | 'desc' }[] {
  const str = String(raw ?? '').trim();
  if (!str) return [];
  return str
    .split(',')
    .map((chunk) => {
      const [field, dir] = chunk.split(':');
      if (!SORTABLE.has(field)) return null;
      return { field, dir: dir === 'desc' ? 'desc' : 'asc' as 'desc' | 'asc' };
    })
    .filter(Boolean) as { field: string; dir: 'asc' | 'desc' }[];
}

/** 应用层多字段比较：支持中文 localeCompare、数值、日期 */
function compareRows(
  sort: { field: string; dir: 'asc' | 'desc' }[],
  favoriteAtMap: Map<number, Date>,
) {
  return (a: any, b: any) => {
    for (const { field, dir } of sort) {
      const sign = dir === 'desc' ? -1 : 1;
      let cmp = 0;
      if (field === 'favoriteAt') {
        const av = favoriteAtMap.get(a.id)?.getTime() ?? 0;
        const bv = favoriteAtMap.get(b.id)?.getTime() ?? 0;
        cmp = av - bv;
      } else {
        const av = a[field];
        const bv = b[field];
        if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
        else cmp = String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN');
      }
      if (cmp !== 0) return cmp * sign;
    }
    return 0;
  };
}

router.get('/', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const pageSize = Math.min(100, Math.max(1, parseIntParam(req.query.pageSize, 24)));
  const q = String(req.query.q || '').trim();
  const grade = String(req.query.grade || '').trim();
  const subject = String(req.query.subject || '').trim();
  const category = String(req.query.category || '').trim();
  const searchable = String(req.query.searchable || '').trim();
  const kind = String(req.query.kind || '').trim();
  const missingParam = String(req.query.missing || '').trim();
  const favoritesOnly = String(req.query.favoritesOnly || '') === '1';
  const sort = parseSort(req.query.sort);
  const userId = req.user?.userId ?? null;

  const where: any = { isDeleted: false };
  if (q) where.title = { contains: q };
  if (grade) where.grade = grade;
  if (subject) where.subject = subject;
  if (category) where.category = category;
  if (searchable) where.searchable = searchable;
  if (kind) where.pdfKind = kind;
  if (missingParam === '1') where.missing = true;
  if (missingParam === '0') where.missing = false;

  // 「收藏」相关的两条路径：只看收藏、按收藏时间排序。
  // 两者都先取该用户的收藏集，因为 MySQL 里无法直接按关联表的 createdAt 排序。
  // standalone 模式（userId 为 null）下没有登录用户，收藏集为空 —— 与既有行为一致。
  const favoriteAtMap = new Map<number, Date>();
  const needsFavorites = favoritesOnly || sort.some((s) => s.field === 'favoriteAt');
  if (needsFavorites) {
    const favs = userId
      ? await prisma.pdfBookFavorite.findMany({
          where: { userId },
          select: { bookId: true, createdAt: true },
        })
      : [];
    for (const f of favs) favoriteAtMap.set(f.bookId, f.createdAt);
    where.id = { in: [...favoriteAtMap.keys()] };
    if (favoriteAtMap.size === 0) {
      return res.json({ data: [], total: 0, page, pageSize });
    }
  }

  // favoriteAt 排序：收藏集规模有限，直接在应用层做多字段排序再分页
  if (sort.some((s) => s.field === 'favoriteAt')) {
    const rows = await prisma.pdfBook.findMany({ where, select: LIST_SELECT });
    rows.sort(compareRows(sort, favoriteAtMap));
    const total = rows.length;
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    return res.json({
      data: slice.map((r: any) => ({ ...r, isFavorite: favoriteAtMap.has(r.id), favoriteAt: favoriteAtMap.get(r.id) ?? null })),
      total,
      page,
      pageSize,
    });
  }

  const orderBy = sort.length
    ? sort.map((s) => ({ [s.field]: s.dir }))
    : [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];

  const [total, items] = await Promise.all([
    prisma.pdfBook.count({ where }),
    prisma.pdfBook.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: LIST_SELECT,
    }),
  ]);

  // 非收藏路径也要给出收藏状态（卡片上的星标）
  if (userId) {
    const favs = await prisma.pdfBookFavorite.findMany({
      where: { userId, bookId: { in: items.map((i: any) => i.id) } },
      select: { bookId: true, createdAt: true },
    });
    for (const f of favs) favoriteAtMap.set(f.bookId, f.createdAt);
  }

  res.json({
    data: items.map((r: any) => ({
      ...r,
      isFavorite: favoriteAtMap.has(r.id),
      favoriteAt: favoriteAtMap.get(r.id) ?? null,
    })),
    total,
    page,
    pageSize,
  });
}));

/** 筛选选项：供前端做下拉，避免把 24k 条数据全拉到前端 */
router.get('/facets', asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const [grades, subjects, categories, counts, kinds, missing] = await Promise.all([
    prisma.pdfBook.groupBy({ by: ['grade'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.groupBy({ by: ['subject'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.groupBy({ by: ['category'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.groupBy({ by: ['searchable'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.groupBy({ by: ['pdfKind'], where: { isDeleted: false }, _count: { _all: true } }),
    prisma.pdfBook.count({ where: { isDeleted: false, missing: true } }),
  ]);
  const norm = (rows: any[]) =>
    rows.filter((r) => r._count._all > 0)
      .map((r) => ({ value: r.grade ?? r.subject ?? r.category, count: r._count._all }))
      .sort((a, b) => b.count - a.count);
  res.json({
    data: {
      grades: norm(grades.map((g) => ({ grade: g.grade, _count: g._count }))),
      subjects: norm(subjects.map((s) => ({ subject: s.subject, _count: s._count }))),
      categories: norm(categories.map((c) => ({ category: c.category, _count: c._count }))),
      searchable: counts.map((c) => ({ value: c.searchable, count: c._count._all })),
      kinds: Object.fromEntries(kinds.map((k) => [k.pdfKind, k._count._all])),
      missing: missing,
    },
  });
}));

router.get('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const resolved = await resolveBookFile(book);
  res.json({
    data: {
      ...book,
      fileUrl: `/api/pdf/books/${id}/file`,
      coverUrl: `/api/pdf/books/${id}/cover`,
      missing: resolved.missing,
    },
  });
}));

// ─────────────────────────────────────────────────────────────
// PDF 本体 / 封面 / 缩略图 / 文本
// ─────────────────────────────────────────────────────────────

/** 流式返回 PDF 原件。按 id 寻址，规避中文文件名编码问题。 */
router.get('/:id/file', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const resolved = await resolveBookFile(book);
  if (!resolved.ok) return res.status(410).json({ error: 'pdf file missing', missing: true });

  streamFile(req, res, resolved.filePath, 'application/pdf');
}));

/** 元信息：页数、每页尺寸、outline、可搜索性。默认读库，?refresh=1 重新解析。 */
router.get('/:id/meta', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  if (String(req.query.refresh || '') === '1') {
    const resolved = await resolveBookFile(book);
    if (!resolved.ok) return res.status(410).json({ error: 'pdf file missing', missing: true });
    const info = await inspectPdf(resolved.filePath);
    const updated = await prisma.pdfBook.update({
      where: { id },
      data: {
        totalPages: info.totalPages,
        pageSizes: info.pageSizes as any,
        searchable: info.searchable,
        textStats: info.textStats as any,
        pdfKind: info.searchable === 'no_text' ? 'scan' : 'pdf',
        tocSource: info.outline.length ? 'outline' : book.tocSource,
        tocJson: info.outline.length ? (info.outline as any) : (book.tocJson as any),
      },
    });
    return res.json({ data: { ...info, book: updated } });
  }

  res.json({
    data: {
      totalPages: book.totalPages,
      pageSizes: book.pageSizes,
      outline: book.tocJson,
      searchable: book.searchable,
      textStats: book.textStats,
      textExtracted: book.textExtracted,
      tocSource: book.tocSource,
      pdfKind: book.pdfKind,
    },
  });
}));

/** 封面。库中没有则用 pdf.js + canvas 现场渲染并落盘缓存。 */
router.get('/:id/cover', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const resolved = await resolveBookFile(book);
  if (!resolved.ok) return res.status(410).json({ error: 'pdf file missing', missing: true });

  ensurePdfDirs();
  const width = Math.min(800, Math.max(80, parseIntParam(req.query.w, 300)));
  const result = await ensureCover(resolved.filePath, id, book.coverPage || 1, width);
  assertInsidePdfRoot(result.absPath);
  streamFile(req, res, result.absPath, 'image/jpeg');
}));

/** 页缩略图。按需生成 + 落盘缓存（导入时只生成封面，页图首次访问时生成）。 */
router.get('/:id/thumb/:page', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const page = parseIntParam(req.params.page, NaN);
  if (!Number.isFinite(id) || !Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: 'invalid id or page' });
  }

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const resolved = await resolveBookFile(book);
  if (!resolved.ok) return res.status(410).json({ error: 'pdf file missing', missing: true });

  const width = Math.min(400, Math.max(60, parseIntParam(req.query.w, 160)));
  const outPath = getThumbPath(id, page);
  assertInsidePdfRoot(outPath);

  const existed = fs.existsSync(outPath);
  let result;
  try {
    result = await ensureThumb(resolved.filePath, id, page, width);
  } catch {
    // 页码越界在这里才暴露，交给 pdf.js 判断，比拿库里的 totalPages 预判更可靠
    // （库里可能因历史原因存了不准的页数）
    return res.status(404).json({ error: 'page out of range' });
  }

  if (!existed) {
    await prisma.pdfThumb.upsert({
      where: { bookId_pageNumber: { bookId: id, pageNumber: page } },
      create: {
        bookId: id,
        pageNumber: page,
        relPath: path.posix.join('thumbs', String(id), `${page}.jpg`),
        width: result.width,
        height: result.height,
        bytes: result.bytes,
      },
      update: {
        width: result.width,
        height: result.height,
        bytes: result.bytes,
      },
    }).catch(() => {});
  }

  streamFile(req, res, result.absPath, 'image/jpeg');
}));

/** 单页文本层（归一化坐标），供搜索命中后高亮使用 */
router.get('/:id/text/:page', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const page = parseIntParam(req.params.page, NaN);
  if (!Number.isFinite(id) || !Number.isFinite(page) || page < 1) {
    return res.status(400).json({ error: 'invalid id or page' });
  }

  const cached = await prisma.pdfPageText.findUnique({
    where: { bookId_pageNumber: { bookId: id, pageNumber: page } },
  });
  if (cached) {
    return res.json({ data: { pageNumber: page, items: cached.items, plainText: cached.plainText, cached: true } });
  }

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const resolved = await resolveBookFile(book);
  if (!resolved.ok) return res.status(410).json({ error: 'pdf file missing', missing: true });

  const doc = await openPdf(resolved.filePath);
  try {
    const result = await extractPageText(doc, page);
    await prisma.pdfPageText.upsert({
      where: { bookId_pageNumber: { bookId: id, pageNumber: page } },
      create: { bookId: id, pageNumber: page, items: result.items as any, plainText: result.plainText, charCount: result.charCount },
      update: { items: result.items as any, plainText: result.plainText, charCount: result.charCount },
    }).catch(() => {});
    res.json({ data: { pageNumber: page, items: result.items, plainText: result.plainText, cached: false } });
  } finally {
    await doc.destroy();
  }
}));

/** 全书文本层抽取（可指定页范围，便于大书分批） */
router.post('/:id/text/extract', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });
  if (book.searchable === 'no_text' || book.searchable === 'garbled' || book.searchable === 'watermark_only') {
    return res.json({ data: { skipped: true, reason: book.searchable, extracted: 0 } });
  }

  const resolved = await resolveBookFile(book);
  if (!resolved.ok) return res.status(410).json({ error: 'pdf file missing', missing: true });

  const from = Math.max(1, parseIntParam(req.body?.from, 1));
  const to = Math.min(book.totalPages || 1, parseIntParam(req.body?.to, book.totalPages || 1));

  const doc = await openPdf(resolved.filePath);
  let extracted = 0;
  try {
    for (let p = from; p <= to; p++) {
      try {
        const result = await extractPageText(doc, p);
        await prisma.pdfPageText.upsert({
          where: { bookId_pageNumber: { bookId: id, pageNumber: p } },
          create: { bookId: id, pageNumber: p, items: result.items as any, plainText: result.plainText, charCount: result.charCount },
          update: { items: result.items as any, plainText: result.plainText, charCount: result.charCount },
        });
        extracted++;
      } catch {
        /* 单页失败跳过 */
      }
    }
  } finally {
    await doc.destroy();
  }

  if (to >= (book.totalPages || 1)) {
    await prisma.pdfBook.update({ where: { id }, data: { textExtracted: true } });
  }

  res.json({ data: { extracted, from, to, done: to >= (book.totalPages || 1) } });
}));

/** 书内搜索。默认只搜已抽取的文本；auto=1 时先抽取再搜。 */
router.get('/:id/search', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  if (book.searchable !== 'ok') {
    return res.json({
      data: { hits: [], searchable: book.searchable, message: '该书没有可用的文本层，无法搜索' },
    });
  }

  if (!book.textExtracted && String(req.query.auto || '') === '1') {
    const resolved = await resolveBookFile(book);
    if (!resolved.ok) return res.status(410).json({ error: 'pdf file missing', missing: true });
    const doc = await openPdf(resolved.filePath);
    try {
      for (let p = 1; p <= (book.totalPages || 1); p++) {
        try {
          const result = await extractPageText(doc, p);
          await prisma.pdfPageText.upsert({
            where: { bookId_pageNumber: { bookId: id, pageNumber: p } },
            create: { bookId: id, pageNumber: p, items: result.items as any, plainText: result.plainText, charCount: result.charCount },
            update: { items: result.items as any, plainText: result.plainText, charCount: result.charCount },
          });
        } catch { /* skip */ }
      }
      await prisma.pdfBook.update({ where: { id }, data: { textExtracted: true } });
      book.textExtracted = true;
    } finally {
      await doc.destroy();
    }
  }

  if (!book.textExtracted) {
    return res.json({
      data: { hits: [], searchable: book.searchable, textExtracted: false, message: '文本层尚未抽取，请先调用抽取接口' },
    });
  }

  const rows = await prisma.pdfPageText.findMany({
    where: { bookId: id, plainText: { contains: q } },
    orderBy: { pageNumber: 'asc' },
    select: { pageNumber: true, plainText: true },
  });

  const hits = rows.map((r) => {
    const idx = r.plainText.indexOf(q);
    const start = Math.max(0, idx - 30);
    return {
      pageNumber: r.pageNumber,
      snippet: r.plainText.slice(start, start + q.length + 60),
      matchIndex: idx,
    };
  });

  res.json({ data: { hits, searchable: book.searchable, textExtracted: true, query: q } });
}));

// ─────────────────────────────────────────────────────────────
// 维护：hash 计算 / 文件迁移
// ─────────────────────────────────────────────────────────────

/** 重新计算文件 hash（用于与既有 Book.fileHash 建立映射） */
router.post('/:id/rehash', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const book = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const resolved = await resolveBookFile(book);
  if (!resolved.ok) return res.status(410).json({ error: 'pdf file missing', missing: true });

  const fileHash = await hashFile(resolved.filePath);
  const stat = fs.statSync(resolved.filePath);
  const updated = await prisma.pdfBook.update({
    where: { id },
    data: { fileHash, fileSize: stat.size },
  });

  const legacy = await prisma.book.findFirst({
    where: { fileHash, isDeleted: false },
    select: { id: true, title: true, category: true },
  });

  res.json({ data: { fileHash, fileSize: stat.size, legacyBook: legacy, book: updated } });
}));

/** 把文件登记进引用式存储（rootPath + relPath） */
router.post('/:id/relocate', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const { rootPath, filePath } = req.body || {};
  if (!rootPath || !filePath) return res.status(400).json({ error: 'rootPath and filePath required' });

  const { rootPath: root, relPath } = splitRootRel(String(rootPath), String(filePath));
  const abs = path.resolve(String(filePath));
  if (!fs.existsSync(abs)) return res.status(400).json({ error: 'file not found', filePath: abs });

  const book = await prisma.pdfBook.update({
    where: { id },
    data: { rootPath: root, relPath, filePath: abs, missing: false, fileSize: fs.statSync(abs).size },
  });

  res.json({ data: book });
}));

/** 局部更新：标题 / 分类 / 年级 / 学科 / 封面页 / 目录 */
router.patch('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const exists = await prisma.pdfBook.findFirst({ where: { id, isDeleted: false }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'pdf book not found' });

  const body = req.body || {};
  const data: any = {};
  if (typeof body.title === 'string') data.title = body.title.trim();
  if (typeof body.category === 'string') data.category = body.category.trim();
  if (typeof body.grade === 'string') data.grade = body.grade.trim();
  if (typeof body.subject === 'string') data.subject = body.subject.trim();
  if (typeof body.coverPage === 'number' && body.coverPage > 0) data.coverPage = body.coverPage;
  if (Array.isArray(body.tocJson)) {
    data.tocJson = body.tocJson;
    data.tocSource = 'manual';
  }
  if (body.attributes && typeof body.attributes === 'object') data.attributes = body.attributes;

  if (!Object.keys(data).length) return res.status(400).json({ error: 'no fields to update' });

  const book = await prisma.pdfBook.update({ where: { id }, data });
  res.json({ data: book });
}));

router.delete('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  await prisma.pdfBook.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  res.json({ success: true });
}));

export default router;
