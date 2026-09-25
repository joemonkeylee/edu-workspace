import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../../prisma.js';
import { adminRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { cleanPdfName } from '../../services/nameCleaner.js';
import { parseGradeSubjectFromPath } from '../../services/pdfProcessor.js';
import { classifyText, extractPageText, hashFile, inspectPdf, openPdf } from '../services/pdfMeta.js';
import { ensureCover } from '../services/pdfRender.js';
import { splitRootRel } from '../services/pdfStorage.js';
import { getStorageRoot } from '../../services/storage.js';

const router = Router();
router.use(adminRequired);

/** 受限并发映射，避免几千个文件同时打开 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 递归收集目录下的 PDF 文件 */
function collectPdfs(rootPath: string, recursive: boolean, max: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive && depth < 12) walk(full, depth + 1);
      } else if (e.name.toLowerCase().endsWith('.pdf')) {
        out.push(full);
      }
    }
  };
  walk(rootPath, 0);
  return out;
}

// ─────────────────────────────────────────────────────────────
// 扫描预览（dry-run，只解析不入库）
// ─────────────────────────────────────────────────────────────

router.post('/scan/preview', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rootPath = String(req.body?.rootPath || '').trim();
  if (!rootPath) return res.status(400).json({ error: 'rootPath required' });

  const root = path.resolve(rootPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return res.status(400).json({ error: 'rootPath is not a directory', rootPath: root });
  }

  const recursive = req.body?.recursive !== false;
  const max = Math.min(3000, Math.max(1, parseInt(String(req.body?.max ?? 500), 10) || 500));
  const doHash = req.body?.hash !== false;

  const files = collectPdfs(root, recursive, max);

  // 已入库的 hash / relPath，用于标记重复
  const existing = await prisma.pdfBook.findMany({
    where: { isDeleted: false },
    select: { id: true, title: true, fileHash: true, rootPath: true, relPath: true },
  });
  const hashSet = new Map(existing.filter((b) => b.fileHash).map((b) => [b.fileHash as string, b.id]));
  const relSet = new Map(existing.map((b) => [`${b.rootPath}::${b.relPath}`, b.id]));

  const items = await mapLimit(files, 4, async (filePath) => {
    const fileName = path.basename(filePath);
    const { rootPath: rp, relPath } = splitRootRel(root, filePath);
    const cleaned = cleanPdfName(fileName);
    const parsed = parseGradeSubjectFromPath(filePath);

    let totalPages = 0;
    let searchable: string = 'ok';
    let error: string | null = null;
    try {
      const info = await inspectPdf(filePath);
      totalPages = info.totalPages;
      searchable = info.searchable;
    } catch (e: any) {
      error = String(e?.message || e).slice(0, 200);
    }

    let fileHash: string | null = null;
    if (doHash) {
      try {
        fileHash = await hashFile(filePath);
      } catch { /* 忽略 */ }
    }

    const legacy = fileHash
      ? await prisma.book.findFirst({ where: { fileHash, isDeleted: false }, select: { id: true, title: true } })
      : null;

    const existingId = fileHash ? hashSet.get(fileHash) : undefined;
    const existingByRel = relSet.get(`${rp}::${relPath}`);

    return {
      filePath,
      fileName,
      title: cleaned.title || fileName.replace(/\.pdf$/i, ''),
      relPath,
      rootPath: rp,
      category: path.basename(path.dirname(filePath)) === path.basename(root) ? '' : path.basename(path.dirname(filePath)),
      grade: parsed.grade,
      subject: parsed.subject,
      totalPages,
      searchable,
      fileSize: fs.statSync(filePath).size,
      fileHash,
      legacyBookId: legacy?.id ?? null,
      legacyTitle: legacy?.title ?? null,
      alreadyImported: Boolean(existingId || existingByRel),
      existingPdfBookId: existingId ?? existingByRel ?? null,
      error,
    };
  });

  res.json({
    data: {
      rootPath: root,
      scanned: files.length,
      truncated: files.length >= max,
      items,
      summary: {
        total: items.length,
        alreadyImported: items.filter((i) => i.alreadyImported).length,
        matchLegacy: items.filter((i) => i.legacyBookId).length,
        unscannable: items.filter((i) => i.searchable !== 'ok').length,
        errored: items.filter((i) => i.error).length,
      },
    },
  });
}));

// ─────────────────────────────────────────────────────────────
// 批量入库
// ─────────────────────────────────────────────────────────────

router.post('/scan/commit', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rawItems: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) return res.status(400).json({ error: 'items required' });
  if (rawItems.length > 2000) return res.status(400).json({ error: 'too many items (max 2000)' });

  const generateCovers = req.body?.generateCovers !== false;

  const created: { id: number; title: string }[] = [];
  const skipped: { filePath: string; reason: string }[] = [];

  for (const raw of rawItems) {
    const filePath = String(raw?.filePath || '').trim();
    if (!filePath || !fs.existsSync(filePath)) {
      skipped.push({ filePath, reason: 'file not found' });
      continue;
    }

    const rootPath = String(raw?.rootPath || path.dirname(filePath));
    const { rootPath: rp, relPath } = splitRootRel(rootPath, filePath);
    const title = String(raw?.title || path.basename(filePath).replace(/\.pdf$/i, '')).trim();
    const category = String(raw?.category || '').trim();

    const dup = await prisma.pdfBook.findFirst({
      where: {
        isDeleted: false,
        OR: [
          ...(raw?.fileHash ? [{ fileHash: String(raw.fileHash) }] : []),
          { rootPath: rp, relPath },
        ],
      },
      select: { id: true },
    });
    if (dup) {
      skipped.push({ filePath, reason: `already imported (id=${dup.id})` });
      continue;
    }

    try {
      const book = await prisma.pdfBook.create({
        data: {
          title,
          category,
          grade: String(raw?.grade || ''),
          subject: String(raw?.subject || ''),
          batchId: String(req.body?.batchId || ''),
          pdfKind: raw?.searchable === 'no_text' ? 'scan' : 'pdf',
          coverPage: Number(raw?.coverPage) > 0 ? Number(raw.coverPage) : 1,
          totalPages: Number(raw?.totalPages) || 0,
          filePath: path.resolve(filePath),
          rootPath: rp,
          relPath,
          fileSize: Number(raw?.fileSize) || fs.statSync(filePath).size,
          fileHash: raw?.fileHash ? String(raw.fileHash) : null,
          searchable: String(raw?.searchable || 'ok'),
        },
      });
      created.push({ id: book.id, title: book.title });

      if (generateCovers) {
        try {
          await ensureCover(path.resolve(filePath), book.id, book.coverPage, 300);
        } catch (e) {
          console.warn(`[pdf-scan] cover generation failed for book ${book.id}:`, e);
        }
      }
    } catch (e: any) {
      skipped.push({ filePath, reason: String(e?.message || e).slice(0, 200) });
    }
  }

  res.json({ data: { created: created.length, skipped, items: created } });
}));

// ─────────────────────────────────────────────────────────────
// 资源根目录管理（换盘 repoint）
// ─────────────────────────────────────────────────────────────

router.get('/roots', asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const roots = await prisma.pdfSourceRoot.findMany({ orderBy: { id: 'asc' } });
  const withCount = await Promise.all(
    roots.map(async (r) => ({
      ...r,
      liveCount: await prisma.pdfBook.count({ where: { isDeleted: false, rootPath: r.rootPath } }),
    })),
  );
  res.json({ data: withCount });
}));

router.post('/roots', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rootPath = String(req.body?.rootPath || '').trim();
  if (!rootPath) return res.status(400).json({ error: 'rootPath required' });
  const resolved = path.resolve(rootPath);
  const label = String(req.body?.label || path.basename(resolved));
  const found = await prisma.pdfSourceRoot.findFirst({ where: { rootPath: resolved } });
  const root = found
    ? await prisma.pdfSourceRoot.update({ where: { id: found.id }, data: { label } })
    : await prisma.pdfSourceRoot.create({ data: { label, rootPath: resolved } });
  res.json({ data: root });
}));

/** 换盘：把某个根目录下的所有书整体重定向到新根目录 */
router.post('/roots/:id/repoint', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const newRootPath = String(req.body?.rootPath || '').trim();
  if (!Number.isFinite(id) || !newRootPath) return res.status(400).json({ error: 'id and rootPath required' });

  const root = await prisma.pdfSourceRoot.findUnique({ where: { id } });
  if (!root) return res.status(404).json({ error: 'root not found' });

  const resolved = path.resolve(newRootPath);
  const books = await prisma.pdfBook.findMany({
    where: { isDeleted: false, rootPath: root.rootPath },
    select: { id: true, relPath: true },
  });

  let restored = 0;
  let stillMissing = 0;
  for (const b of books) {
    const abs = path.resolve(resolved, b.relPath.split('/').join(path.sep));
    const exists = fs.existsSync(abs);
    await prisma.pdfBook.update({
      where: { id: b.id },
      data: { rootPath: resolved, filePath: abs, missing: !exists },
    });
    if (exists) restored++;
    else stillMissing++;
  }

  await prisma.pdfSourceRoot.update({
    where: { id },
    data: { rootPath: resolved, bookCount: books.length },
  });

  res.json({ data: { total: books.length, restored, stillMissing, rootPath: resolved } });
}));

// ─────────────────────────────────────────────────────────────
// 从既有 Book 播种（只读旧库，不写任何旧表）
// ─────────────────────────────────────────────────────────────

/**
 * 把「既有 Book 且 storage/books/{id}/ 下确实有 PDF 原件」的书以元数据形式播种到 pdf_book。
 *
 * 严格遵守隔离原则：
 *   · 只 READ 旧表，不 UPDATE / DELETE 任何既有记录
 *   · 只写 pdf_book
 *   · 只读文件系统，不移动、不复制、不删除任何文件
 */
router.post('/seed-from-books', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const dryRun = req.body?.dryRun === true;
  const limit = Math.min(20000, Math.max(1, parseInt(String(req.body?.limit ?? 5000), 10) || 5000));
  const generateCovers = req.body?.generateCovers === true;

  const booksRoot = path.join(getStorageRoot(), 'books');
  const legacy = await prisma.book.findMany({
    where: { isDeleted: false },
    select: { id: true, title: true, category: true, grade: true, subject: true, fileHash: true, totalPages: true },
    take: limit,
    orderBy: { id: 'asc' },
  });

  // 是否用 pdf.js 实测元信息。
  // 旧表里的 totalPages 可能不准（历史原因），播种时实测一遍更可靠；
  // 代价是每本几毫秒，5000 本约 1~2 分钟。
  const inspect = req.body?.inspect !== false;

  const plan: {
    legacyBookId: number; title: string; category: string; grade: string; subject: string;
    filePath: string; relPath: string; totalPages: number; fileHash: string | null;
    searchable: string; pageSizes: { w: number; h: number }[] | null;
    action: 'create' | 'skip-exists' | 'skip-dup-hash';
  }[] = [];

  for (const b of legacy) {
    const dir = path.join(booksRoot, String(b.id));
    if (!fs.existsSync(dir)) continue;
    const fileName = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!fileName) continue;

    const filePath = path.join(dir, fileName);
    const { rootPath, relPath } = splitRootRel(booksRoot, filePath);

    let totalPages = b.totalPages;
    let searchable = 'ok';
    let pageSizes: { w: number; h: number }[] | null = null;
    if (inspect) {
      try {
        const info = await inspectPdf(filePath);
        totalPages = info.totalPages;
        searchable = info.searchable;
        pageSizes = info.pageSizes;
      } catch {
        /* 解析失败则退回旧值 */
      }
    }

    const byHash = b.fileHash
      ? await prisma.pdfBook.findFirst({ where: { fileHash: b.fileHash, isDeleted: false }, select: { id: true } })
      : null;
    const byRel = await prisma.pdfBook.findFirst({ where: { rootPath, relPath, isDeleted: false }, select: { id: true } });

    plan.push({
      legacyBookId: b.id,
      title: b.title,
      category: b.category,
      grade: b.grade,
      subject: b.subject,
      filePath,
      relPath,
      totalPages,
      fileHash: b.fileHash,
      searchable,
      pageSizes,
      action: byRel ? 'skip-exists' : (byHash ? 'skip-dup-hash' : 'create'),
    });
  }

  if (dryRun) {
    return res.json({
      data: {
        dryRun: true,
        examinedLegacyBooks: legacy.length,
        candidates: plan.length,
        toCreate: plan.filter((p) => p.action === 'create').length,
        skipped: plan.filter((p) => p.action !== 'create').length,
        sample: plan.slice(0, 20),
      },
    });
  }

  let created = 0;
  for (const p of plan) {
    if (p.action !== 'create') continue;
    try {
      const book = await prisma.pdfBook.create({
        data: {
          title: p.title,
          category: p.category,
          grade: p.grade,
          subject: p.subject,
          batchId: 'seed-from-books',
          totalPages: p.totalPages,
          pdfKind: p.searchable === 'no_text' ? 'scan' : 'pdf',
          searchable: p.searchable,
          pageSizes: p.pageSizes as any,
          filePath: p.filePath,
          rootPath: booksRoot,
          relPath: p.relPath,
          fileHash: p.fileHash,
          fileSize: fs.statSync(p.filePath).size,
        },
      });
      created++;
      if (generateCovers) {
        try {
          await ensureCover(p.filePath, book.id, 1, 300);
        } catch { /* 忽略单本失败 */ }
      }
    } catch (e: any) {
      console.warn(`[pdf-seed] create failed for legacy book ${p.legacyBookId}:`, e?.message);
    }
  }

  res.json({
    data: {
      examinedLegacyBooks: legacy.length,
      candidates: plan.length,
      created,
      skipped: plan.length - created,
    },
  });
}));

// ─────────────────────────────────────────────────────────────
// 批量判定可搜索性（对已入库的书重跑文本层检测）
// ─────────────────────────────────────────────────────────────

router.post('/recheck-searchable', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.body?.limit ?? 50), 10) || 50));
  const books = await prisma.pdfBook.findMany({
    where: { isDeleted: false, missing: false },
    select: { id: true, filePath: true, rootPath: true, relPath: true },
    take: limit,
    orderBy: { updatedAt: 'asc' },
  });

  let updated = 0;
  const results: { id: number; searchable: string }[] = [];
  for (const b of books) {
    const abs = fs.existsSync(b.filePath)
      ? b.filePath
      : path.resolve(b.rootPath, b.relPath.split('/').join(path.sep));
    if (!fs.existsSync(abs)) continue;
    try {
      const info = await inspectPdf(abs);
      await prisma.pdfBook.update({
        where: { id: b.id },
        data: {
          searchable: info.searchable,
          textStats: info.textStats as any,
          totalPages: info.totalPages,
          pageSizes: info.pageSizes as any,
          pdfKind: info.searchable === 'no_text' ? 'scan' : 'pdf',
        },
      });
      updated++;
      results.push({ id: b.id, searchable: info.searchable });
    } catch { /* skip */ }
  }

  res.json({ data: { examined: books.length, updated, results } });
}));

export default router;
