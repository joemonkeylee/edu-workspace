import fs from 'fs';
import path from 'path';
import { openPdf } from './pdfMeta.js';
import { ensureBookThumbDir, ensurePdfDirs, getCoverPath, getThumbPath } from './pdfStorage.js';

/**
 * 服务端渲染封面 / 页缩略图。
 *
 * 渲染依赖 @napi-rs/canvas（预编译二进制，无需本地编译 cairo）。
 * 生成结果落盘缓存，重复请求直接命中文件。
 */

let canvasLib: any = null;

/**
 * ⚠️ 必须保证进程内只有一份 @napi-rs/canvas。
 *
 * pdf.js 在 Node 下会自己 `require('@napi-rs/canvas')` 来做 Path2D/DOMMatrix 的
 * polyfill。如果项目里存在两份物理副本（例如根目录和 server/ 各一份），pdf.js
 * 用 A 副本的 Path2D，而我们用 B 副本的 ctx，两者实例不兼容，会在渲染时
 * 报 `InvalidArg`，进一步还会直接段错误（exit 139）。
 *
 * 因此依赖声明在**根 workspace** 的 package.json 里，只保留一份。
 * 这里额外做一次防御：把全局 Path2D/DOMMatrix 强制指向我们实际使用的这份。
 */
async function getCanvasLib() {
  if (!canvasLib) {
    canvasLib = await import('@napi-rs/canvas');
    if (typeof (globalThis as any).Path2D === 'undefined' && canvasLib.Path2D) {
      (globalThis as any).Path2D = canvasLib.Path2D;
    }
    if (typeof (globalThis as any).DOMMatrix === 'undefined' && canvasLib.DOMMatrix) {
      (globalThis as any).DOMMatrix = canvasLib.DOMMatrix;
    }
  }
  return canvasLib;
}

export interface RenderResult {
  /** 生成文件的绝对路径 */
  absPath: string;
  width: number;
  height: number;
  bytes: number;
}

/**
 * 把某一页渲染成 jpg。
 * @param targetWidth 目标宽度（px），高度按页面比例自动计算
 */
export async function renderPageToJpg(
  filePath: string,
  pageNumber: number,
  outPath: string,
  targetWidth: number,
): Promise<RenderResult> {
  const { createCanvas } = await getCanvasLib();
  const doc = await openPdf(filePath);
  try {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    if (!base.width || !base.height) throw new Error('invalid page size');
    const scale = targetWidth / base.width;
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    await (page as any).render({
      canvasContext: ctx,
      viewport,
    }).promise;

    const buf = canvas.toBuffer('image/jpeg', 82);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return { absPath: outPath, width, height, bytes: buf.length };
  } finally {
    await doc.destroy();
  }
}

/** 生成封面（pageNumber = coverPage）。已存在则直接返回。 */
export async function ensureCover(
  filePath: string,
  bookId: number,
  coverPage: number,
  width = 300,
): Promise<RenderResult> {
  ensurePdfDirs();
  const out = getCoverPath(bookId);
  if (fs.existsSync(out)) {
    const st = fs.statSync(out);
    return { absPath: out, width, height: 0, bytes: st.size };
  }
  return renderPageToJpg(filePath, coverPage, out, width);
}

/** 生成页缩略图（按需生成，落盘缓存）。 */
export async function ensureThumb(
  filePath: string,
  bookId: number,
  pageNumber: number,
  width = 160,
): Promise<RenderResult> {
  ensureBookThumbDir(bookId);
  const out = getThumbPath(bookId, pageNumber);
  if (fs.existsSync(out)) {
    const st = fs.statSync(out);
    return { absPath: out, width, height: 0, bytes: st.size };
  }
  return renderPageToJpg(filePath, pageNumber, out, width);
}
