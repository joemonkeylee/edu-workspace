import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma.js';
import { getPdfInfo, extractOutline, renderPages } from '../services/pdfProcessor.js';

const router = Router();

const STORAGE_ABS = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');

router.get('/scan-pdf', async (req: Request, res: Response) => {
  const targetPath = req.query.targetPath as string;
  const explicitCategory = req.query.category as string;
  const dpi = parseInt((req.query.dpi as string) || '200', 10);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type: string, data: any) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
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

    send('log', { message: `扫描完成，找到 ${pdfFiles.length} 个 PDF 文件` });

    for (let i = 0; i < pdfFiles.length; i++) {
      const pdfPath = pdfFiles[i];
      const fileName = path.basename(pdfPath);
      send('log', { message: `[${i + 1}/${pdfFiles.length}] 正在处理: ${fileName}` });

      try {
        const info = getPdfInfo(pdfPath);
        const pdfCategory = explicitCategory || path.basename(path.dirname(pdfPath)) || '未分类';
        send('log', { message: `  共 ${info.pages} 页，标题: ${info.title}，分类: ${pdfCategory}` });

        send('log', { message: `  正在提取目录...` });
        const toc = await extractOutline(pdfPath, info.pages);
        send('log', { message: `  目录提取完成，${toc.length} 个条目` });

        const book = await prisma.book.create({
          data: {
            title: info.title,
            category: pdfCategory,
            totalPages: info.pages,
            storagePath: '',
            tocJson: toc,
          },
        });

        const bookDir = path.join(STORAGE_ABS, 'books', String(book.id));
        send('log', { message: `  创建书籍记录: ID=${book.id}` });
        send('log', { message: `  开始渲染 ${info.pages} 页 (DPI=${dpi})...` });

        const images = await renderPages(pdfPath, bookDir, dpi, (current, total) => {
          if (current % 10 === 0 || current === total) {
            send('progress', { current, total, message: `  渲染进度: ${current}/${total}` });
          }
        });

        const storagePath = `/storage/books/${book.id}/`;
        await prisma.book.update({
          where: { id: book.id },
          data: { storagePath },
        });

        send('log', { message: `  渲染完成，共 ${images.length} 张图片` });
        send('log', { message: `  ✓ 处理完成: ${info.title} (${info.pages}页)` });
      } catch (err: any) {
        send('log', { message: `  ✗ 处理失败: ${err.message}` });
      }
    }

    send('done', { message: `全部完成，共处理 ${pdfFiles.length} 个 PDF`, count: pdfFiles.length });
  } catch (err: any) {
    send('error', { message: `系统错误: ${err.message}` });
  } finally {
    res.end();
  }
});

export default router;
