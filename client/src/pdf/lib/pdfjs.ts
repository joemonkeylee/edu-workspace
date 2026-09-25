import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getAccessToken } from '../../api/client';

/**
 * pdf.js 统一入口。
 *
 * worker 通过 Vite 的 ?url 导入，会被打包成独立 chunk；
 * pdfjs 本体约 1MB，只在进入 /pdf/* 路由时才被加载（见路由的 lazy 引入）。
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

export interface OpenOptions {
  /** 只渲染前 N 页时可传，减少首屏等待 */
  url: string;
}

/**
 * 打开一个 PDF 文档。
 * 关键：直接把 URL 交给 pdf.js，让它自己发 Range 请求，
 * 这样 189MB 的大书也不需要整包下载就能渲染第一页。
 */
export async function openDocument(url: string) {
  const token = getAccessToken();
  const params: Record<string, unknown> = {
    url,
    // 关闭字体自动加载，避免跨域字体请求导致渲染卡住
    disableFontFace: false,
    isEvalSupported: false,
  };
  if (token) {
    params.httpHeaders = { Authorization: `Bearer ${token}` };
  }
  return pdfjs.getDocument(params).promise;
}

/** 文档级缓存：同一本书在会话内只解析一次 */
const docCache = new Map<string, Promise<any>>();

export function getCachedDocument(url: string) {
  let cached = docCache.get(url);
  if (!cached) {
    cached = openDocument(url).catch((err) => {
      docCache.delete(url);
      throw err;
    });
    docCache.set(url, cached);
  }
  return cached;
}

export function evictDocument(url: string) {
  docCache.delete(url);
}

/**
 * 离屏按目标像素宽度渲染整页，返回 canvas。
 *
 * 裁剪错题与导出作业图都需要「原始分辨率」的底图 —— 屏幕上 800px 宽的那张
 * canvas 裁下来放大就糊了。这里按指定宽度重新渲染一页（PDF 是矢量，放大不失真），
 * crop / export 再从这个 canvas 上按归一化坐标取矩形。
 */
export async function renderPageOffscreen(
  doc: any,
  pageNumber: number,
  targetWidthPx: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const width = Math.max(1, Math.min(4096, Math.round(targetWidthPx)));
  const viewport = page.getViewport({ scale: width / base.width });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  const task = page.render({ canvasContext: ctx, viewport });
  await task.promise;
  return canvas;
}

/** 页面自然尺寸（PDF 点），用于计算缩放与適配 */
export async function getPageSize(doc: any, pageNumber: number) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { w: viewport.width, h: viewport.height, rotation: viewport.rotation };
}

/** 渲染中的取消异常，属于正常流程而非错误 */
export function isCancelError(e: any): boolean {
  return e?.name === 'RenderingCancelledException';
}

/**
 * 按目标 CSS 宽度渲染某一页到 canvas。
 * devicePixelRatio 一起乘进去，保证高 DPI 屏不糊。
 */
export async function renderPageToCanvas(
  doc: any,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = (cssWidth / base.width) * dpr;
  const viewport = page.getViewport({ scale });

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

  const task = page.render({ canvasContext: ctx, viewport });
  await task.promise;

  return { width: canvas.width, height: canvas.height };
}
