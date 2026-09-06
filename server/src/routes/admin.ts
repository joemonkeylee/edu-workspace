import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import prisma from '../prisma.js';
import { getPdfInfo, extractOutline, renderPages, getAvailableDpis, parseGradeSubjectFromPath, isDpiComplete } from '../services/pdfProcessor.js';
import { runWithConcurrency } from '../utils/concurrency.js';

const router = Router();

const STORAGE_ABS = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');

interface PdfTask {
  pdfPath: string;
  fileName: string;
  category: string;
  title: string;
  pages: number;
  grade: string;
  subject: string;
}

router.get('/scan-pdf', async (req: Request, res: Response) => {
  const targetPath = req.query.targetPath as string;
  const explicitCategory = req.query.category as string;
  const dpi = parseInt((req.query.dpi as string) || '300', 10);
  // Concurrency: default to min(4, cores-1), cap at 8 to avoid choking the system
  const concurrency = Math.min(parseInt((req.query.concurrency as string) || String(Math.min(4, os.cpus().length - 1)), 10), 8);

  // Batch ID: YYYYMMDDHHmm — all books imported in this scan share the same batchId
  const now = new Date();
  const batchId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type: string, data: any) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
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

    send('log', { message: `扫描完成，找到 ${pdfFiles.length} 个 PDF 文件，目标 DPI=${dpi}，并发数=${concurrency}` });

    // Phase 1: collect PDF info (parallelized — pdfinfo is quick)
    const tasks: PdfTask[] = [];
    await runWithConcurrency(pdfFiles, Math.min(8, concurrency * 2), async (pdfPath) => {
      const fileName = path.basename(pdfPath);
      try {
        const info = getPdfInfo(pdfPath);
        const pdfCategory = explicitCategory || path.basename(path.dirname(pdfPath)) || '未分类';
        const title = path.basename(pdfPath, '.pdf') || info.title;
        const { grade, subject } = parseGradeSubjectFromPath(pdfPath);
        tasks.push({ pdfPath, fileName, category: pdfCategory, title, pages: info.pages, grade, subject });
      } catch {
        send('log', { message: `跳过（无法读取）: ${fileName}` });
      }
    });

    const totalPages = tasks.reduce((s, t) => s + t.pages, 0);
    send('log', { message: `共 ${tasks.length} 个有效 PDF，合计 ${totalPages} 页` });

    // Pre-scan: build a lookup of existing books by title::category
    const existingBooks = await prisma.book.findMany({ select: { id: true, title: true, category: true } });
    const existingMap = new Map<string, number>();
    for (const b of existingBooks) {
      existingMap.set(`${b.title}::${b.category}`, b.id);
    }

    // Phase 2a: separate already-complete tasks from ones needing processing
    const toProcess: PdfTask[] = [];
    let skippedComplete = 0;
    let skippedIncomplete = 0;

    for (const task of tasks) {
      const bookId = existingMap.get(`${task.title}::${task.category}`);
      if (bookId) {
        const bookDir = path.join(STORAGE_ABS, 'books', String(bookId));
        if (isDpiComplete(bookDir, dpi, task.pages)) {
          skippedComplete++;
          send('log', { message: `跳过（已导入）: ${task.fileName}` });
          continue;
        }
        skippedIncomplete++;
      }
      toProcess.push(task);
    }

    send('log', { message: `预检完成: 跳过已导入 ${skippedComplete} 本，需渲染 ${toProcess.length} 本（其中 ${skippedIncomplete} 本为不完整重渲）` });

    if (toProcess.length === 0) {
      send('done', { message: `全部完成，所有 ${tasks.length} 个 PDF 均已导入，无需处理`, count: tasks.length, elapsed: 0 });
      return res.end();
    }

    const pagesToProcess = toProcess.reduce((s, t) => s + t.pages, 0);
    const secPerPage = 0.3 * (dpi / 150);
    send('log', { message: `预计渲染 ${pagesToProcess} 页，并发=${concurrency}，预计耗时: ${fmtTime(pagesToProcess * secPerPage / concurrency)}` });

    const startTime = Date.now();
    let processedPages = 0;
    const pageProgress: Record<number, number> = {};

    // Phase 2b: process books with a concurrency pool
    await runWithConcurrency(toProcess, concurrency, async (task, idx) => {
      send('log', { message: `[${idx + 1}/${toProcess.length}] 正在处理: ${task.fileName}` });

      try {
        const existing = await prisma.book.findFirst({
          where: { title: task.title, category: task.category },
        });

        let bookId: number;
        let isNew = false;

        if (existing) {
          bookId = existing.id;
          const bookDir = path.join(STORAGE_ABS, 'books', String(bookId));
          const dpiDir = path.join(bookDir, String(dpi));

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
              tocJson: toc as any,
            },
          });
          bookId = book.id;
          isNew = true;
          send('log', { message: `  创建书籍记录: ID=${bookId} (阶段=${task.grade || '-'} 学科=${task.subject || '-'})` });
        }

        const bookDir = path.join(STORAGE_ABS, 'books', String(bookId));
        const dpiDir = path.join(bookDir, String(dpi));
        send('log', { message: `  开始渲染 ${task.pages} 页 (DPI=${dpi})...` });

        const images = await renderPages(task.pdfPath, dpiDir, dpi, task.pages, (current) => {
          const prev = pageProgress[idx] || 0;
          const delta = current - prev;
          pageProgress[idx] = current;
          processedPages += delta;
          const elapsed = (Date.now() - startTime) / 1000;
          const overallProgress = (processedPages / pagesToProcess) * 100;
          const remaining = (pagesToProcess - processedPages) * secPerPage / concurrency;
          send('progress', {
            current,
            total: task.pages,
            overallCurrent: processedPages,
            overallTotal: pagesToProcess,
            overallPct: Math.round(overallProgress),
            elapsed: Math.round(elapsed),
            remaining: Math.round(remaining),
            message: `  渲染: ${current}/${task.pages} | 总进度: ${processedPages}/${pagesToProcess} (${Math.round(overallProgress)}%) 剩余 ${fmtTime(remaining)}`,
          });
        });

        const allDpis = getAvailableDpis(bookDir);
        const storagePath = `/storage/books/${bookId}/`;
        await prisma.book.update({
          where: { id: bookId },
          data: { storagePath, totalPages: task.pages, batchId },
        });

        send('log', { message: `  渲染完成，共 ${images.length} 张图片，可用 DPI: ${allDpis.join(', ')}` });
        send('log', { message: `  ✓ 处理完成: ${task.title} (${task.pages}页)` });
      } catch (err: any) {
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
    res.end();
  }
});

export default router;
