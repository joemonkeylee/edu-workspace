import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma.js';
import { getPdfInfo, extractOutline, renderPages, getAvailableDpis } from '../services/pdfProcessor.js';

const router = Router();

const STORAGE_ABS = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');

interface PdfTask {
  pdfPath: string;
  fileName: string;
  category: string;
  title: string;
  pages: number;
}

router.get('/scan-pdf', async (req: Request, res: Response) => {
  const targetPath = req.query.targetPath as string;
  const explicitCategory = req.query.category as string;
  const dpi = parseInt((req.query.dpi as string) || '300', 10);

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

    send('log', { message: `扫描完成，找到 ${pdfFiles.length} 个 PDF 文件，目标 DPI=${dpi}` });

    // Phase 1: collect PDF info
    const tasks: PdfTask[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfPath = pdfFiles[i];
      const fileName = path.basename(pdfPath);
      try {
        const info = getPdfInfo(pdfPath);
        const pdfCategory = explicitCategory || path.basename(path.dirname(pdfPath)) || '未分类';
        tasks.push({ pdfPath, fileName, category: pdfCategory, title: info.title, pages: info.pages });
      } catch {
        send('log', { message: `[${i + 1}/${pdfFiles.length}] 跳过（无法读取）: ${fileName}` });
      }
    }

    const totalPages = tasks.reduce((s, t) => s + t.pages, 0);
    send('log', { message: `共 ${tasks.length} 个有效 PDF，合计 ${totalPages} 页` });

    // Time estimation: ~0.3s/page at 150dpi, scale linearly
    const secPerPage = 0.3 * (dpi / 150);
    const estTotal = totalPages * secPerPage;
    send('log', { message: `预计耗时: ${fmtTime(estTotal)}` });

    const startTime = Date.now();
    let processedPages = 0;

    // Phase 2: process each PDF
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      send('log', { message: `[${i + 1}/${tasks.length}] 正在处理: ${task.fileName}` });

      try {
        // Find existing book by title+category
        const existing = await prisma.book.findFirst({
          where: { title: task.title, category: task.category },
        });

        let bookId: number;
        let isNew = false;

        if (existing) {
          bookId = existing.id;
          const bookDir = path.join(STORAGE_ABS, 'books', String(bookId));
          const dpiDir = path.join(bookDir, String(dpi));

          // Check if this DPI already exists
          const existingDpis = getAvailableDpis(bookDir);
          if (existingDpis.includes(dpi)) {
            send('log', { message: `  书籍已存在，DPI=${dpi} 已有，覆盖重新渲染...` });
            fs.rmSync(dpiDir, { recursive: true, force: true });
          } else {
            send('log', { message: `  书籍已存在，新增 DPI=${dpi} 渲染（已有: ${existingDpis.join(', ')}）` });
          }
        } else {
          // Create new book
          send('log', { message: `  提取目录...` });
          const toc = await extractOutline(task.pdfPath, task.pages);
          send('log', { message: `  目录提取完成，${toc.length} 个条目` });

          const book = await prisma.book.create({
            data: {
              title: task.title,
              category: task.category,
              totalPages: task.pages,
              storagePath: '',
              tocJson: toc as any,
            },
          });
          bookId = book.id;
          isNew = true;
          send('log', { message: `  创建书籍记录: ID=${bookId}` });
        }

        const bookDir = path.join(STORAGE_ABS, 'books', String(bookId));
        const dpiDir = path.join(bookDir, String(dpi));
        send('log', { message: `  开始渲染 ${task.pages} 页 (DPI=${dpi})${isNew ? '' : ' [覆盖/新增]'}...` });

        const prevBookPages = tasks.slice(0, i).reduce((s, t) => s + t.pages, 0);
        const images = await renderPages(task.pdfPath, dpiDir, dpi, task.pages, (current, total) => {
          processedPages = prevBookPages + current;
          const elapsed = (Date.now() - startTime) / 1000;
          const overallProgress = (processedPages / totalPages) * 100;
          const remaining = (totalPages - processedPages) * secPerPage;
          send('progress', {
            current, total,
            overallCurrent: processedPages,
            overallTotal: totalPages,
            overallPct: Math.round(overallProgress),
            elapsed: Math.round(elapsed),
            remaining: Math.round(remaining),
            message: `  渲染: ${current}/${total} | 总进度: ${processedPages}/${totalPages} (${Math.round(overallProgress)}%) 剩余 ${fmtTime(remaining)}`,
          });
        });

        // Update storagePath to reflect available DPIs
        const allDpis = getAvailableDpis(bookDir);
        const storagePath = `/storage/books/${bookId}/`;
        await prisma.book.update({
          where: { id: bookId },
          data: { storagePath, totalPages: task.pages },
        });

        send('log', { message: `  渲染完成，共 ${images.length} 张图片，可用 DPI: ${allDpis.join(', ')}` });
        send('log', { message: `  ✓ 处理完成: ${task.title} (${task.pages}页)` });
      } catch (err: any) {
        send('log', { message: `  ✗ 处理失败: ${err.message}` });
      }
    }

    const elapsedTotal = (Date.now() - startTime) / 1000;
    send('done', {
      message: `全部完成，共处理 ${tasks.length} 个 PDF，耗时 ${fmtTime(elapsedTotal)}`,
      count: tasks.length,
      elapsed: Math.round(elapsedTotal),
    });
  } catch (err: any) {
    send('error', { message: `系统错误: ${err.message}` });
  } finally {
    res.end();
  }
});

export default router;
