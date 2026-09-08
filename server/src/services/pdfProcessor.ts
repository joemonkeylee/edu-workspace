import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const POPPLER_CANDIDATES = [
  '/opt/homebrew/opt/poppler/bin',
  '/usr/local/opt/poppler/bin',
  '/opt/local/lib/poppler/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/bin',
];

const POPPLER_BIN = POPPLER_CANDIDATES.find((dir) => {
  if (!dir || !fs.existsSync(dir)) return false;
  return fs.existsSync(path.join(dir, 'pdfinfo')) || fs.existsSync(path.join(dir, 'pdftoppm'));
}) || POPPLER_CANDIDATES[0];

const EXTRA_PATH = [POPPLER_BIN, process.env.PATH || '']
  .filter(Boolean)
  .join(':');
const SHELL_ENV = { ...process.env, PATH: EXTRA_PATH };

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

export async function getPdfInfo(filePath: string): Promise<PdfInfo> {
  const { stdout } = await execFileAsync('pdfinfo', [filePath], { encoding: 'utf-8', env: SHELL_ENV, maxBuffer: 1024 * 1024 });
  const info: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
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
  totalPages: number,
  onProgress?: (current: number, total: number) => void
): Promise<string[]> {
  fs.mkdirSync(outputDir, { recursive: true });
  const prefix = path.join(outputDir, 'page');

  return new Promise((resolve, reject) => {
    const proc = spawn('pdftoppm', [
      '-png', '-r', String(dpi),
      inputPath, prefix
    ], { env: SHELL_ENV });

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const pollInterval = setInterval(() => {
      try {
        const files = fs.readdirSync(outputDir).filter(f => /^page-\d+\.png$/.test(f));
        onProgress?.(files.length, totalPages);
      } catch { /* ignore */ }
    }, 500);

    proc.on('close', (code) => {
      clearInterval(pollInterval);

      if (code !== 0) {
        reject(new Error(`pdftoppm 渲染失败: ${stderr}`));
        return;
      }

      const files = fs.readdirSync(outputDir)
        .filter(f => /^page-\d+\.png$/.test(f))
        .sort((a, b) => {
          const na = parseInt(a.match(/page-(\d+)/)![1]);
          const nb = parseInt(b.match(/page-(\d+)/)![1]);
          return na - nb;
        });

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
      });

      onProgress?.(renamed.length, totalPages);
      resolve(renamed);
    });

    proc.on('error', (err) => {
      clearInterval(pollInterval);
      reject(err);
    });
  });
}

export function getAvailableDpis(bookDir: string): number[] {
  if (!fs.existsSync(bookDir)) return [];
  return fs.readdirSync(bookDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d+$/.test(e.name))
    .map(e => parseInt(e.name, 10))
    .sort((a, b) => b - a);
}

export async function getAvailableDpisAsync(bookDir: string): Promise<number[]> {
  try {
    const entries = await fs.promises.readdir(bookDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && /^\d+$/.test(e.name))
      .map(e => parseInt(e.name, 10))
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

/**
 * Check if a DPI directory exists and contains the expected number of pages.
 * Used to skip re-rendering books that have already been imported.
 */
export function isDpiComplete(bookDir: string, dpi: number, expectedPages: number): boolean {
  const dpiDir = path.join(bookDir, String(dpi));
  if (!fs.existsSync(dpiDir)) return false;
  try {
    const files = fs.readdirSync(dpiDir).filter(f => /^page-\d{4}\.png$/.test(f));
    return files.length >= expectedPages;
  } catch {
    return false;
  }
}

const SUBJECT_KEYWORDS = [
  '语文', '数学', '英语', '物理', '化学', '生物', '道法', '历史', '地理', '科学',
  '政治', '美术', '音乐', '体育', '信息技术', '通用技术', '道德与法治',
];

const GRADE_MAP: Record<string, string> = {
  '七': '七上', '7': '七上', '初一': '七上', '高一上': '高一上',
  '八': '八上', '8': '八上', '初二': '八上', '初二上': '八上',
  '九': '九上', '9': '九上', '初三': '九上', '初三上': '九上',
  '高一': '高一', '高二': '高二', '高三': '高三',
};

/**
 * Parse grade (学期) and subject (学科) from a PDF file path.
 *
 * Recognised patterns (tried in order, directory parts from deepest to shallowest,
 * then filename as fallback):
 *
 * Grade patterns:
 *   七年级上册 / 7年级上册 / 七年级上 / 7年级上  → "七上"
 *   七年级下册 / 7年级下册 / 七年级下 / 7年级下  → "七下"
 *   初一上 / 初一下       → "七上" / "七下"
 *   初二上 / 初二下       → "八上" / "八下"
 *   初三上 / 初三下       → "九上" / "九下"
 *   高一 / 高二 / 高三    → "高一" / "高二" / "高三"
 *
 * Subject: extracted from the same folder/filename text if a known keyword is found.
 */
export function parseGradeSubjectFromPath(pdfPath: string): { grade: string; subject: string } {
  const parts = pdfPath.split(path.sep);

  // Regex: captures grade number (Chinese or Arabic), optional 上下, optional 册
  const gradeRegex = /([七八九7-9])年级([上下])?(?:册)?/;
  const chuZhongRegex = /初([一二三])([上下])?/;
  const gaoZhongRegex = /高([一二三])([上下])?/;

  const tryMatch = (text: string): { grade: string; subject: string } | null => {
    // Middle school: 七/八/九年级 + 上下册
    const m1 = text.match(gradeRegex);
    if (m1) {
      const num = m1[1];
      const half = m1[2] || '上';
      const gradeNum = GRADE_MAP[num] ? GRADE_MAP[num].replace('上', half) : '';
      const grade = gradeNum || `${num}年级${half}`;
      const subject = extractSubject(text.replace(gradeRegex, ''));
      return { grade, subject };
    }

    // 初一/初二/初三 + optional 上下
    const m2 = text.match(chuZhongRegex);
    if (m2) {
      const chuMap: Record<string, string> = { '一': '七', '二': '八', '三': '九' };
      const num = chuMap[m2[1]] || m2[1];
      const half = m2[2] || '上';
      const grade = `${num}${half}`;
      const subject = extractSubject(text.replace(chuZhongRegex, ''));
      return { grade, subject };
    }

    // 高一/高二/高三
    const m3 = text.match(gaoZhongRegex);
    if (m3) {
      const grade = `高${m3[1]}${m3[2] || ''}`;
      const subject = extractSubject(text.replace(gaoZhongRegex, ''));
      return { grade, subject };
    }

    return null;
  };

  // 1) Walk through directory parts (exclude the filename at the end)
  for (let i = parts.length - 2; i >= 0; i--) {
    const result = tryMatch(parts[i]);
    if (result) return result;
  }

  // 2) Fallback: try the filename (strip .pdf)
  const fileName = parts[parts.length - 1].replace(/\.pdf$/i, '');
  const result = tryMatch(fileName);
  if (result) return result;

  return { grade: '', subject: '' };
}

function extractSubject(rest: string): string {
  const trimmed = (rest || '').trim();
  for (const kw of SUBJECT_KEYWORDS) {
    if (trimmed.includes(kw)) return kw;
  }
  return '';
}

export function getBestDpiPath(bookDir: string): { dpi: number; dir: string } | null {
  const dpis = getAvailableDpis(bookDir);
  if (dpis.length === 0) return null;
  return { dpi: dpis[0], dir: path.join(bookDir, String(dpis[0])) };
}

export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function normalizeSourcePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(normalized)];
}

export function mergeSourcePaths(...groups: unknown[]): string[] {
  const merged = new Set<string>();
  for (const group of groups) {
    for (const item of normalizeSourcePaths(group)) {
      merged.add(item);
    }
  }
  return [...merged];
}
