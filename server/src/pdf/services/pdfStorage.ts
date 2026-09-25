import fs from 'fs';
import path from 'path';
import { getStorageRoot } from '../../services/storage.js';

/**
 * PDF 原生模块的存储布局，与既有 storage 完全隔离：
 *
 *   storage/pdf/
 *   ├── covers/{bookId}.jpg      封面
 *   ├── thumbs/{bookId}/{page}.jpg  页缩略图（按需生成后缓存）
 *   └── crops/                   错题裁图
 *
 * 注意：PDF 原件不复制，只存引用路径（rootPath + relPath）。
 */

function safeMkdir(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err: any) {
    console.warn(`[pdf-storage] mkdir failed (${err.code || 'EACCES'}): ${dir}`);
  }
}

export function getPdfRoot() {
  return path.join(getStorageRoot(), 'pdf');
}

export function getPdfCoversRoot() {
  return path.join(getPdfRoot(), 'covers');
}

export function getPdfThumbsRoot() {
  return path.join(getPdfRoot(), 'thumbs');
}

export function getPdfCropsRoot() {
  return path.join(getPdfRoot(), 'crops');
}

export function getCoverPath(bookId: number) {
  return path.join(getPdfCoversRoot(), `${bookId}.jpg`);
}

export function getThumbPath(bookId: number, pageNumber: number) {
  return path.join(getPdfThumbsRoot(), String(bookId), `${pageNumber}.jpg`);
}

/** 相对 pdf root 的路径，用于存 PdfThumb.relPath */
export function getThumbRelPath(bookId: number, pageNumber: number) {
  return path.posix.join('thumbs', String(bookId), `${pageNumber}.jpg`);
}

export function ensurePdfDirs() {
  for (const dir of [getPdfRoot(), getPdfCoversRoot(), getPdfThumbsRoot(), getPdfCropsRoot()]) {
    safeMkdir(dir);
  }
}

export function ensureBookThumbDir(bookId: number) {
  safeMkdir(path.join(getPdfThumbsRoot(), String(bookId)));
}

/**
 * 把绝对路径拆成「根目录 + 相对路径」，用于引用式存储。
 * 相对路径统一使用 / 分隔，与平台无关。
 */
export function splitRootRel(rootPath: string, filePath: string) {
  const root = path.resolve(rootPath);
  const full = path.resolve(filePath);
  const rel = path.relative(root, full).split(path.sep).join('/');
  return { rootPath: root, relPath: rel };
}

/** 重新拼接出当前绝对路径（换盘后 rootPath 变化，relPath 不变） */
export function joinRootRel(rootPath: string, relPath: string) {
  return path.resolve(rootPath, relPath.split('/').join(path.sep));
}
