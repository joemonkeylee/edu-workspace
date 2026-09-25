import fs from 'fs';
import crypto from 'crypto';

/**
 * PDF 元信息解析与文本层判定。
 *
 * ---------------------------------------------------------------------------
 * 文本层判定规则（全量 5661 本实测定稿，别轻易改）：
 *
 *   1. 累计去空白字符 < 20              → no_text        扫描件，不可搜
 *   2. 控制字符占比 > 2%                → garbled        字体编码映射失败
 *   3. 长度 < 300 且无中日韩字符        → watermark_only 只有水印串
 *   4. 其余                             → ok             可搜
 *
 * 踩过的坑（这三个判据都误判过，不要再用）：
 *   × 私用区字符（U+E000-F8FF）占比 —— 数学公式字体大量使用它编码符号，
 *     实测 priv>10% 的 34 本全部是可读中文，误判率 100%。
 *   × 可打印字符占比 —— 中文全角标点不在常见 printable 区间，正常书只有 0.62。
 *   × CJK 占比低 —— 英语试卷 CJK 仅 3~5%，但完全可读可搜。
 *   控制字符占比才是真信号：两本真乱码分别是 0.60 和 0.97。
 * ---------------------------------------------------------------------------
 */

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export type Searchable = 'ok' | 'no_text' | 'garbled' | 'watermark_only';

export interface TextItem {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageText {
  items: TextItem[];
  plainText: string;
  charCount: number;
}

export interface PdfInspection {
  totalPages: number;
  /** 每页尺寸（pt）：[{ w, h }]，按页存储以防同书内尺寸混排 */
  pageSizes: { w: number; h: number }[];
  /** PDF 自带 outline，可能为空 */
  outline: { title: string; page: number | null }[];
  searchable: Searchable;
  textStats: {
    sampledPages: number;
    sampledChars: number;
    avgCharsPerPage: number;
    ctrlRatio: number;
  };
}

async function loadPdfjs(): Promise<any> {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

export async function openPdf(filePath: string): Promise<any> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  return pdfjs.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;
}

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 统计控制字符占比 */
function ctrlRatio(str: string): number {
  if (!str) return 0;
  let ctrl = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20) ctrl++;
  }
  return ctrl / str.length;
}

export function classifyText(raw: string): Searchable {
  const bare = raw.replace(/\s/g, '');
  if (bare.length < 20) return 'no_text';
  if (ctrlRatio(bare) > 0.02) return 'garbled';
  if (bare.length < 300 && !CJK_RE.test(bare)) return 'watermark_only';
  return 'ok';
}

/** 采样页码：首、中、尾（页数 <= 3 时全部） */
function samplePages(total: number): number[] {
  if (total <= 3) return Array.from({ length: total }, (_, i) => i + 1);
  return [1, Math.ceil(total / 2), total];
}

/** 抽取单页文本层，坐标全部归一化到 0-1（与批注/笔迹坐标系一致） */
export async function extractPageText(doc: any, pageNumber: number): Promise<PageText> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  let plain = '';
  for (const it of tc.items as any[]) {
    const str = typeof it?.str === 'string' ? it.str : '';
    if (!str) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const w = typeof it.width === 'number' ? it.width : 0;
    const h = typeof it.height === 'number' ? it.height : 0;
    items.push({
      t: str,
      x: +(tr[4] / vp.width).toFixed(5),
      y: +(1 - (tr[5] + h) / vp.height).toFixed(5),
      w: +(w / vp.width).toFixed(5),
      h: +(h / vp.height).toFixed(5),
    });
    plain += str;
  }
  const plainText = plain.replace(/\s+/g, ' ').trim();
  return { items, plainText, charCount: plainText.length };
}

/**
 * 解析 PDF 元信息：页数、每页尺寸、outline、文本层可搜索性。
 * 只采样 3 页做判定，因此大文件也能毫秒级返回。
 */
export async function inspectPdf(filePath: string): Promise<PdfInspection> {
  const doc = await openPdf(filePath);
  try {
    const totalPages = doc.numPages;
    const pageSizes: { w: number; h: number }[] = [];
    for (let p = 1; p <= totalPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      pageSizes.push({ w: +vp.width.toFixed(2), h: +vp.height.toFixed(2) });
      page.cleanup?.();
    }

    let outline: { title: string; page: number | null }[] = [];
    try {
      const raw = await doc.getOutline();
      outline = flattenOutline(raw);
    } catch {
      outline = [];
    }

    const picks = samplePages(totalPages);
    let sampled = '';
    for (const p of picks) {
      try {
        const { plainText } = await extractPageText(doc, p);
        sampled += plainText;
      } catch {
        /* 单页失败不影响整本判定 */
      }
    }
    const bare = sampled.replace(/\s/g, '');
    const stats = {
      sampledPages: picks.length,
      sampledChars: bare.length,
      avgCharsPerPage: picks.length ? Math.round(bare.length / picks.length) : 0,
      ctrlRatio: +ctrlRatio(bare).toFixed(4),
    };

    return {
      totalPages,
      pageSizes,
      outline,
      searchable: classifyText(sampled),
      textStats: stats,
    };
  } finally {
    await doc.destroy();
  }
}

function flattenOutline(nodes: any[] | null, out: { title: string; page: number | null }[] = []) {
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    out.push({ title: String(n?.title || '').trim(), page: resolveOutlinePage(n) });
    if (Array.isArray(n?.items)) flattenOutline(n.items, out);
  }
  return out;
}

/** outline 里的 dest 可能是字符串（命名目标）或数组（显式目标） */
function resolveOutlinePage(node: any): number | null {
  const dest = node?.dest;
  if (Array.isArray(dest)) {
    const ref = dest[0];
    if (ref && typeof ref === 'object') return null; // 需要 obj 号映射，暂不解析
  }
  return null;
}
