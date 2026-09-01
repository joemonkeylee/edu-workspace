import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface PdfInfo {
  pages: number;
  title: string;
  author: string;
}

export interface TocNode {
  title: string;
  page: number;
  children?: TocNode[];
}

export function getPdfInfo(filePath: string): PdfInfo {
  const output = execSync(`pdfinfo "${filePath}"`, { encoding: 'utf-8' });
  const info: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      info[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  const pages = parseInt(info['Pages'] || '0', 10);
  const title = info['Title'] || path.basename(filePath, '.pdf');
  const author = info['Author'] || '';
  return { pages, title, author };
}

export async function extractOutline(filePath: string, totalPages: number): Promise<TocNode[]> {
  try {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
    const outline = await doc.getOutline();

    if (!outline || outline.length === 0) {
      await doc.destroy();
      return flatToc(totalPages);
    }

    const toc = await mapOutline(outline, doc);
    await doc.destroy();
    return toc;
  } catch {
    return flatToc(totalPages);
  }
}

async function mapOutline(items: any[], doc: any): Promise<TocNode[]> {
  const result: TocNode[] = [];
  for (const item of items) {
    let page = 0;
    try {
      let dest = item.dest;
      if (typeof dest === 'string') {
        dest = await doc.getDestination(dest);
      }
      if (Array.isArray(dest) && dest[0]) {
        const pageIndex = await doc.getPageIndex(dest[0]);
        page = pageIndex + 1;
      }
    } catch {
      // keep page = 0 if resolution fails
    }
    const node: TocNode = {
      title: item.title || `第 ${page} 页`,
      page: page > 0 ? page : 1,
    };
    if (item.items && item.items.length > 0) {
      node.children = await mapOutline(item.items, doc);
    }
    result.push(node);
  }
  return result;
}

function flatToc(totalPages: number): TocNode[] {
  const toc: TocNode[] = [];
  for (let i = 1; i <= totalPages; i++) {
    toc.push({ title: `第 ${i} 页`, page: i });
  }
  return toc;
}

export async function renderPages(
  inputPath: string,
  outputDir: string,
  dpi: number,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  fs.mkdirSync(outputDir, { recursive: true });

  const prefix = path.join(outputDir, 'page');
  const result = spawnSync('pdftoppm', [
    '-png', '-r', String(dpi),
    inputPath, prefix
  ], { encoding: 'utf-8' });

  if (result.status !== 0) {
    throw new Error(`pdftoppm 渲染失败: ${result.stderr || result.stdout}`);
  }

  const files = fs.readdirSync(outputDir)
    .filter(f => /^page-\d+\.png$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/page-(\d+)/)![1]);
      const nb = parseInt(b.match(/page-(\d+)/)![1]);
      return na - nb;
    });

  const total = files.length;
  const renamed: string[] = [];
  files.forEach((file, idx) => {
    const current = idx + 1;
    const oldPath = path.join(outputDir, file);
    const newName = `page-${String(current).padStart(4, '0')}.png`;
    const newPath = path.join(outputDir, newName);
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }
    renamed.push(newName);
    onProgress?.(current, total);
  });

  return renamed;
}
