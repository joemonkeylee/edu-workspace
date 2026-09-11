import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import prisma from '../prisma.js';
import { getPdfInfo, extractOutline, renderPages, getAvailableDpis, parseGradeSubjectFromPath, isDpiComplete, hashFile, mergeSourcePaths, normalizeSourcePaths } from '../services/pdfProcessor.js';
import { runWithDynamicConcurrency } from '../utils/concurrency.js';
import { getBookRoot, getStorageRoot, inspectStorageRoot, setStorageRoot } from '../services/storage.js';
import { execFile } from 'child_process';
import { adminRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
const maxConcurrency = Math.max(1, os.cpus().length - 1);
const scanConcurrency = new Map<string, { value: number }>();

router.use(adminRequired);

router.get('/scan-pdf/capacity', (_req: Request, res: Response) => {
  res.json({ cores: os.cpus().length, maxConcurrency });
});

router.post('/scan-pdf/concurrency', (req: Request, res: Response) => {
  const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : '';
  const requested = Number(req.body?.concurrency);
  const task = scanConcurrency.get(taskId);
  if (!task) return res.json({ concurrency: requested, active: false });
  task.value = Math.max(1, Math.min(maxConcurrency, Math.floor(requested)));
  res.json({ concurrency: task.value, active: true });
});

router.get('/storage', asyncHandler(async (_req: Request, res: Response) => {
  const current = await inspectStorageRoot(getStorageRoot());
  res.json(current);
}));

router.post('/storage/inspect', asyncHandler(async (req: Request, res: Response) => {
  const targetPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  if (!targetPath) return res.status(400).json({ error: '资源目录不能为空' });
  res.json(await inspectStorageRoot(targetPath));
}));

router.put('/storage', asyncHandler(async (req: Request, res: Response) => {
  const targetPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  if (!targetPath) return res.status(400).json({ error: '资源目录不能为空' });
  const inspection = await inspectStorageRoot(targetPath);
  if (!inspection.exists) fs.mkdirSync(inspection.path, { recursive: true });
  const storagePath = await setStorageRoot(inspection.path);
  res.json({ path: storagePath, matchedBooks: inspection.matchedBooks, totalBooks: inspection.totalBooks });
}));

router.post('/storage/open', (req: Request, res: Response) => {
  const storageRoot = path.resolve(getStorageRoot());
  const targetPath = typeof req.body?.path === 'string' && req.body.path.trim()
    ? path.resolve(req.body.path.trim())
    : storageRoot;
  // Whitelist: only allow paths inside storage root
  if (!targetPath.startsWith(storageRoot + path.sep) && targetPath !== storageRoot) {
    return res.status(403).json({ error: '只能打开资源目录内的路径' });
  }
  fs.mkdirSync(targetPath, { recursive: true });
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(command, [targetPath], (error) => {
    if (error) return res.status(500).json({ error: `无法打开目录: ${error.message}` });
    res.json({ success: true });
  });
});

interface PdfTask {
  pdfPath: string;
  fileName: string;
  category: string;
  title: string;
  pages: number;
  fileHash: string;
  grade: string;
  subject: string;
}

// Pre-scan preview: parse a directory and return parsed metadata without importing
router.post('/scan-pdf/preview', asyncHandler(async (req: Request, res: Response) => {
  const targetPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  if (!targetPath || !fs.existsSync(targetPath)) {
    return res.status(400).json({ error: '路径不存在' });
  }

  const stat = fs.statSync(targetPath);
  let pdfFiles: string[] = [];

  if (stat.isFile() && targetPath.toLowerCase().endsWith('.pdf')) {
    pdfFiles = [targetPath];
  } else if (stat.isDirectory()) {
    const scanDir = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...scanDir(fullPath));
        } else if (entry.name.toLowerCase().endsWith('.pdf')) {
          results.push(fullPath);
        }
      }
      return results;
    };
    pdfFiles = scanDir(targetPath);
  }

  const overrideGrade = typeof req.body?.grade === 'string' ? req.body.grade.trim() : '';
  const overrideSubject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const overrideCategory = typeof req.body?.category === 'string' ? req.body.category.trim() : '';

  // Generate a preview batchId so grade-less files can be grouped (per-call, includes seconds)
  const pNow = new Date();
  const previewBatchId = `${pNow.getFullYear()}${String(pNow.getMonth() + 1).padStart(2, '0')}${String(pNow.getDate()).padStart(2, '0')}${String(pNow.getHours()).padStart(2, '0')}${String(pNow.getMinutes()).padStart(2, '0')}${String(pNow.getSeconds()).padStart(2, '0')}`;

  const results = pdfFiles.map((pdfPath) => {
    const fileName = path.basename(pdfPath);
    const title = path.basename(pdfPath, '.pdf');
    const parsed = parseGradeSubjectFromPath(pdfPath);
    const category = overrideCategory || path.basename(path.dirname(pdfPath)) || '未分类';
    const grade = overrideGrade || parsed.grade || previewBatchId;
    return {
      fileName,
      fullPath: pdfPath,
      category,
      grade,
      subject: overrideSubject || parsed.subject,
      title,
    };
  });

  res.json({ files: results, total: results.length });
}));

router.get('/scan-pdf', async (req: Request, res: Response) => {
  const targetPath = req.query.targetPath as string;
  const explicitCategory = req.query.category as string;
  const explicitGrade = req.query.grade as string;
  const explicitSubject = req.query.subject as string;
  const skipDb = req.query.skipDb === 'true';
  const dpi = parseInt((req.query.dpi as string) || '300', 10);
  // Concurrency: default to min(4, cores-1), cap at 8 to avoid choking the system
  const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : crypto.randomUUID();
  const initialConcurrency = Math.max(1, Math.min(maxConcurrency, parseInt((req.query.concurrency as string) || String(Math.min(4, maxConcurrency)), 10)));
  const concurrencyState = { value: initialConcurrency };
  scanConcurrency.set(taskId, concurrencyState);

  // Batch ID: YYYYMMDDHHmmss — all books imported in this scan share the same batchId
  const now = new Date();
  const batchId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Throttled SSE sender: progress every 100ms (smooth), logs batched every 250ms
  let pendingLogs: { message: string }[] = [];
  let lastProgress: any = null;
  let logTimer: NodeJS.Timeout | null = null;
  let progressTimer: NodeJS.Timeout | null = null;

  const flushLogs = () => {
    logTimer = null;
    if (pendingLogs.length === 0) return;
    const batch = pendingLogs;
    pendingLogs = [];
    // Send all logs in one SSE message as a batch array
    res.write(`event: logBatch\n`);
    res.write(`data: ${JSON.stringify({ messages: batch.map(l => l.message) })}\n\n`);
  };

  const flushProgress = () => {
    progressTimer = null;
    if (!lastProgress) return;
    res.write(`event: progress\n`);
    res.write(`data: ${JSON.stringify(lastProgress)}\n\n`);
    lastProgress = null;
  };

  const send = (type: string, data: any) => {
    if (type === 'error' || type === 'done') {
      if (logTimer) { clearTimeout(logTimer); logTimer = null; }
      if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
      flushLogs();
      flushProgress();
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return;
    }
    if (type === 'progress') {
      lastProgress = data;
      if (!progressTimer) {
        progressTimer = setTimeout(flushProgress, 100);
      }
    } else {
      pendingLogs.push(data);
      if (!logTimer) {
        logTimer = setTimeout(flushLogs, 250);
      }
    }
  };

  const fmtTime = (s: number) => {
    if (s < 60) return `${Math.round(s)}秒`;
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return `${m}分${r}秒`;
  };

  try {
    if (!targetPath || !fs.existsSync(targetPath)) {
      send('error', { message: `路径不存在: ${targetPath}` });
      return res.end();
    }

    const stat = fs.statSync(targetPath);
    let pdfFiles: string[] = [];

    if (stat.isFile() && targetPath.toLowerCase().endsWith('.pdf')) {
      pdfFiles = [targetPath];
    } else if (stat.isDirectory()) {
      const scanDir = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const results: string[] = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results.push(...scanDir(fullPath));
          } else if (entry.name.toLowerCase().endsWith('.pdf')) {
            results.push(fullPath);
          }
        }
        return results;
      };
      pdfFiles = scanDir(targetPath);
    }

    if (pdfFiles.length === 0) {
      send('error', { message: '未找到 PDF 文件' });
      return res.end();
    }

    send('log', { message: `扫描完成，找到 ${pdfFiles.length} 个 PDF 文件，目标 DPI=${dpi}，并发数=${concurrencyState.value}` });

    // Phase 1: collect PDF info (async — pdfinfo and hash are non-blocking)
    const tasks: PdfTask[] = [];
    let phase1Done = 0;
    const phase1Total = pdfFiles.length;
    const phase1Interval = Math.max(10, Math.floor(phase1Total / 20));
    const phase1Start = Date.now();
    await runWithDynamicConcurrency(pdfFiles, () => Math.min(maxConcurrency, concurrencyState.value * 2), async (pdfPath: string) => {
      const fileName = path.basename(pdfPath);
      try {
        const info = await getPdfInfo(pdfPath);
        const pdfCategory = explicitCategory || path.basename(path.dirname(pdfPath)) || '未分类';
        const title = path.basename(pdfPath, '.pdf') || info.title;
        const { grade: parsedGrade, subject: parsedSubject } = parseGradeSubjectFromPath(pdfPath);
        const grade = explicitGrade || parsedGrade || batchId;
        const subject = explicitSubject || parsedSubject;
        const fileHash = await hashFile(pdfPath);
        tasks.push({ pdfPath, fileName, category: pdfCategory, title, pages: info.pages, fileHash, grade, subject });
      } catch {
        send('log', { message: `跳过（无法读取）: ${fileName}` });
      }
      phase1Done++;
      if (phase1Done % phase1Interval === 0 || phase1Done === phase1Total) {
        const elapsed = (Date.now() - phase1Start) / 1000;
        const rate = phase1Done / elapsed;
        const remaining = (phase1Total - phase1Done) / rate;
        send('progress', {
          phase: 1,
          current: phase1Done,
          total: phase1Total,
          message: `分析中: ${phase1Done}/${phase1Total} 剩余 ${fmtTime(remaining)}`,
        });
      }
    });

    const totalPages = tasks.reduce((s, t) => s + t.pages, 0);
    send('log', { message: `共 ${tasks.length} 个有效 PDF，合计 ${totalPages} 页` });

    // Pre-scan: build lookup maps for existing books by title::category and by file hash.
    const existingBooks = await prisma.book.findMany({
      select: { id: true, title: true, category: true, fileHash: true, sourcePaths: true },
    });
    const existingMap = new Map<string, number>();
    const hashLookup = new Map<string, number[]>();
    for (const b of existingBooks) {
      existingMap.set(`${b.title}::${b.category}`, b.id);
      if (b.fileHash) {
        const bookIds = hashLookup.get(b.fileHash) || [];
        bookIds.push(b.id);
        hashLookup.set(b.fileHash, bookIds);
      }
    }

    // Phase 2a: separate already-complete tasks from ones needing processing,
    // while also skipping any duplicate PDF content discovered in this batch.
    const toProcess: PdfTask[] = [];
    const seenHashes = new Set<string>();
    const extraPathsByHash = new Map<string, string[]>(); // within-batch duplicate paths to merge later
    let skippedComplete = 0;
    let skippedIncomplete = 0;
    let skippedDupContent = 0;
    let skippedDupBatch = 0;

    for (const task of tasks) {
      // Content identity wins over filename/category. A PDF that already exists
      // anywhere in the library only adds its source path and is never rendered again.
      const duplicateIds = hashLookup.get(task.fileHash) || [];
      if (duplicateIds.length > 0) {
        const sourceBooks = await prisma.book.findMany({
          where: { id: { in: duplicateIds } },
          select: { id: true, sourcePaths: true },
        });
        const mergedPaths = mergeSourcePaths(...sourceBooks.map((book) => book.sourcePaths), task.pdfPath);
        await Promise.all(sourceBooks.map((book) => prisma.book.update({
          where: { id: book.id },
          data: { sourcePaths: mergedPaths as any },
        })));
        seenHashes.add(task.fileHash);
        skippedDupContent++;
        send('log', { message: `跳过（重复文件内容）: ${task.fileName} → 已记录路径到已有书籍` });
        continue;
      }

      const bookId = existingMap.get(`${task.title}::${task.category}`);
      const existing = bookId ? existingBooks.find((b) => b.id === bookId) : null;

      if (existing) {
        const bookDir = getBookRoot(existing.id);

        // Same title + category AND same content (hash matches)
        if (existing.fileHash === task.fileHash) {
          if (isDpiComplete(bookDir, dpi, task.pages)) {
            skippedComplete++;
            send('log', { message: `跳过（已导入）: ${task.fileName}` });
            continue;
          }
          // Incomplete but same content → re-render to complete the pages
          skippedIncomplete++;
          seenHashes.add(task.fileHash);
          toProcess.push(task);
          continue;
        }

        // Same title + category but different content (hash changed) → re-render
        skippedIncomplete++;
        seenHashes.add(task.fileHash);
        toProcess.push(task);
        continue;
      }

      // Different title/category. Check if content already exists in DB.
      if (seenHashes.has(task.fileHash)) {
        // Duplicate within this batch — record path for the first occurrence
        const extras = extraPathsByHash.get(task.fileHash) || [];
        extras.push(task.pdfPath);
        extraPathsByHash.set(task.fileHash, extras);
        skippedDupBatch++;
        send('log', { message: `跳过（本批次重复内容）: ${task.fileName}` });
        continue;
      }

      // Brand new book
      seenHashes.add(task.fileHash);
      toProcess.push(task);
    }

    send('log', { message: `预检完成: 已导入跳过 ${skippedComplete}，重渲 ${skippedIncomplete}，内容重复跳过 ${skippedDupContent + skippedDupBatch}，需渲染 ${toProcess.length} 本` });

    if (toProcess.length === 0) {
      send('done', { message: `全部完成，所有 ${tasks.length} 个 PDF 均已导入，无需处理`, count: tasks.length, elapsed: 0 });
      return res.end();
    }

    const pagesToProcess = toProcess.reduce((s, t) => s + t.pages, 0);
    const secPerPage = 0.3 * (dpi / 150);
    send('log', { message: `预计渲染 ${pagesToProcess} 页，并发=${concurrencyState.value}，预计耗时: ${fmtTime(pagesToProcess * secPerPage / concurrencyState.value)}` });

    const startTime = Date.now();
    let processedPages = 0;
    const pageProgress: Record<number, number> = {};

    // Phase 2b: process books with a concurrency pool
    await runWithDynamicConcurrency(toProcess, () => concurrencyState.value, async (task: PdfTask, idx: number) => {
      send('log', { message: `[${idx + 1}/${toProcess.length}] 正在处理: ${task.fileName}` });

      let createdBookId: number | null = null;
      try {
        let bookId: number;
        let bookDir: string;

        if (skipDb) {
          // skipDb mode: find book by hash, only render images to storage
          const existingByHash = await prisma.book.findFirst({
            where: { fileHash: task.fileHash },
            select: { id: true },
          });
          if (!existingByHash) {
            send('log', { message: `  ✗ 跳过（数据库中无匹配记录）: ${task.fileName}` });
            return;
          }
          bookId = existingByHash.id;
          bookDir = getBookRoot(bookId);
          send('log', { message: `  匹配到 Book ID=${bookId}` });
        } else {
          const existing = await prisma.book.findFirst({
            where: { title: task.title, category: task.category },
          });

          let isNew = false;

          if (existing) {
            bookId = existing.id;
            bookDir = getBookRoot(bookId);
            const dpiDir = path.join(bookDir, String(dpi));

            const mergedSourcePaths = mergeSourcePaths(existing.sourcePaths, task.pdfPath, ...(extraPathsByHash.get(task.fileHash) || []));
            if (!existing.fileHash || existing.fileHash !== task.fileHash) {
              await prisma.book.update({
                where: { id: bookId },
                data: {
                  fileHash: task.fileHash,
                  sourcePaths: mergedSourcePaths as any,
                },
              });
            }

            if ((!existing.grade || !existing.subject) && (task.grade || task.subject)) {
              await prisma.book.update({
                where: { id: bookId },
                data: {
                  ...(task.grade && !existing.grade ? { grade: task.grade } : {}),
                  ...(task.subject && !existing.subject ? { subject: task.subject } : {}),
                },
              });
              send('log', { message: `  补全阶段/学科: ${task.grade || '-'} / ${task.subject || '-'}` });
            }

            // Re-render incomplete or missing DPI
            const existingDpis = getAvailableDpis(bookDir);
            if (existingDpis.includes(dpi)) {
              send('log', { message: `  DPI=${dpi} 渲染不完整，重新渲染...` });
              fs.rmSync(dpiDir, { recursive: true, force: true });
            } else {
              send('log', { message: `  新增 DPI=${dpi} 渲染（已有: ${existingDpis.join(', ') || '无'}）` });
            }
          } else {
            send('log', { message: `  提取目录...` });
            const toc = await extractOutline(task.pdfPath, task.pages);
            send('log', { message: `  目录提取完成，${toc.length} 个条目` });

            const book = await prisma.book.create({
              data: {
                title: task.title,
                category: task.category,
                grade: task.grade,
                subject: task.subject,
                batchId,
                totalPages: task.pages,
                storagePath: '',
                fileHash: task.fileHash,
                sourcePaths: [task.pdfPath, ...(extraPathsByHash.get(task.fileHash) || [])] as any,
                tocJson: toc as any,
              },
            });
            bookId = book.id;
            isNew = true;
            createdBookId = bookId;
            bookDir = getBookRoot(bookId);
            send('log', { message: `  创建书籍记录: ID=${bookId} (阶段=${task.grade || '-'} 学科=${task.subject || '-'})` });
          }

          fs.mkdirSync(bookDir, { recursive: true });
          const hasArchivedPdf = fs.readdirSync(bookDir).some((name) => name.toLowerCase().endsWith('.pdf'));
          if (!hasArchivedPdf) {
            fs.copyFileSync(task.pdfPath, path.join(bookDir, path.basename(task.fileName)));
          }
        }
        const dpiDir = path.join(bookDir, String(dpi));
        send('log', { message: `  开始渲染 ${task.pages} 页 (DPI=${dpi})...` });

        let lastSentPct = -1;
        let lastSentTime = 0;
        const images = await renderPages(task.pdfPath, dpiDir, dpi, task.pages, (current) => {
          const prev = pageProgress[idx] || 0;
          const delta = current - prev;
          pageProgress[idx] = current;
          processedPages += delta;
          const overallProgress = (processedPages / pagesToProcess) * 100;
          const pct = Math.round(overallProgress);
          const now = Date.now();
          // Thin: only send when pct changes by ≥1% or 2s since last send
          if (pct === lastSentPct && now - lastSentTime < 2000) return;
          lastSentPct = pct;
          lastSentTime = now;
          const elapsed = (now - startTime) / 1000;
          const remaining = (pagesToProcess - processedPages) * secPerPage / concurrencyState.value;
          send('progress', {
            current,
            total: task.pages,
            overallCurrent: processedPages,
            overallTotal: pagesToProcess,
            overallPct: pct,
            elapsed: Math.round(elapsed),
            remaining: Math.round(remaining),
          });
        });

        const allDpis = getAvailableDpis(bookDir);
        if (!skipDb) {
          const storagePath = `/storage/books/${bookId}/`;
          const existingForUpdate = await prisma.book.findUnique({ where: { id: bookId }, select: { sourcePaths: true } });
          const finalSourcePaths = mergeSourcePaths(existingForUpdate?.sourcePaths, task.pdfPath, ...(extraPathsByHash.get(task.fileHash) || []));
          await prisma.book.update({
            where: { id: bookId },
            data: { storagePath, totalPages: task.pages, batchId, fileHash: task.fileHash, sourcePaths: finalSourcePaths as any },
          });
        }

        send('log', { message: `  渲染完成，共 ${images.length} 张图片，可用 DPI: ${allDpis.join(', ')}` });
        send('log', { message: `  ✓ 处理完成: ${task.title} (${task.pages}页)` });
      } catch (err: any) {
        // Rollback: delete newly created book record if render failed
        if (createdBookId !== null) {
          try {
            await prisma.book.delete({ where: { id: createdBookId } });
            const failedDir = getBookRoot(createdBookId);
            fs.rmSync(failedDir, { recursive: true, force: true });
            send('log', { message: `  已回滚: 删除半残书籍记录 ID=${createdBookId}` });
          } catch { /* book may already be deleted */ }
        }
        send('log', { message: `  ✗ 处理失败: ${err.message}` });
      }
    });

    const elapsedTotal = (Date.now() - startTime) / 1000;
    send('done', {
      message: `全部完成，处理 ${toProcess.length} 个 PDF（跳过已导入 ${skippedComplete} 个），耗时 ${fmtTime(elapsedTotal)}`,
      count: toProcess.length,
      elapsed: Math.round(elapsedTotal),
    });
  } catch (err: any) {
    send('error', { message: `系统错误: ${err.message}` });
  } finally {
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    scanConcurrency.delete(taskId);
    res.end();
  }
});

export default router;
