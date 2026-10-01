import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import prisma from '../../prisma.js';
import { nextShortId } from '../../shared/shortId.js';
import { scanVideos, matchVideosToPdfs, type VideoFile } from '../../services/videoMatcher.js';

/**
 * 专栏 PDF 入库服务。
 *
 * 行为（与 pdf_book 的 /scan/commit 不同）：
 *   · 把源盘 PDF 搬到目标盘：mode='copy'（默认，**保留源文件**）或 mode='move'（复制 + 校验 + 删源）
 *   · sha256 写进 column_book.fileHash，作为唯一性判据
 *   · 源盘绝对路径写进 column_book.sourcePath，用于「该源文件已迁移」识别与重复拷贝去重
 *   · 按 sourcePath / fileHash / (rootPath, relPath) 三重去重，重复项跳过（幂等）
 *   · 用 videoMatcher 扫描源目录的 mp4，关联到 column_video（同 BookVideo 机制，不复制视频）
 *
 * 不生成封面（封面属于专栏详情页 P5 范畴）。
 */

export interface ColumnImportItem {
  /** 源盘绝对路径 */
  filePath: string;
  title?: string;
  category?: string;
  subject?: string;
  grade?: string;
  series?: string;
  totalPages?: number;
  searchable?: string;
  fileSize?: number;
  fileHash?: string | null;
}

export interface ColumnImportOptions {
  /** 目标根目录（organized tree 的根），如 /Volumes/COLORFUL256/source/pdf */
  targetRoot?: string;
  batchId?: string;
  /** 是否允许覆盖已存在的目标文件（默认 false = 跳过） */
  overwrite?: boolean;
  /**
   * 搬运方式：
   *   'copy'（默认）—— 只复制，源盘文件保留；
   *   'move' —— 复制 + 校验后删除源文件（危险，不可撤销）。
   */
  mode?: 'copy' | 'move';
}

export interface ColumnImportResult {
  created: { id: string; title: string; relPath: string }[];
  skipped: { filePath: string; reason: string }[];
  videoCount: number;
  mode: 'copy' | 'move';
}

const DEFAULT_TARGET_ROOT = process.env.COLUMN_PDF_ROOT || '/Volumes/COLORFUL256/source/pdf';

/** 清洗目录/文件名片段，避免路径穿越与非法字符（exFAT 不允许 : * ? " < > | 及 / \） */
function sanitizeSeg(s: string): string {
  return s
    .replace(/[\/\\]+/g, '_')
    .replace(/[:*?"<>|]/g, '_')
    .replace(/^\.+$/, '_')
    .trim()
    .slice(0, 120) || '_';
}

/** 计算目标相对路径：{subject}/{grade}/{源目录名}/{文件名}.pdf */
function buildTargetRel(item: ColumnImportItem, sourceAbs: string): string {
  const subject = sanitizeSeg(item.subject || '未分科目');
  const grade = sanitizeSeg(item.grade || '未分年级');
  const sourceDirName = sanitizeSeg(path.basename(path.dirname(sourceAbs)));
  const fileName = sanitizeSeg(path.basename(sourceAbs));
  return [subject, grade, sourceDirName, fileName].join('/');
}

/** 复制文件并累计 sha256，复制完成后校验字节数一致 */
async function copyFileWithHash(src: string, dst: string): Promise<{ size: number; hash: string }> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const rs = fs.createReadStream(src);
    const ws = fs.createWriteStream(dst);
    rs.on('data', (chunk) => { hash.update(chunk); });
    rs.on('error', reject);
    ws.on('error', reject);
    rs.pipe(ws).on('finish', resolve);
  });
  const srcSize = fs.statSync(src).size;
  const dstSize = fs.statSync(dst).size;
  if (srcSize !== dstSize) {
    fs.rmSync(dst, { force: true });
    throw new Error(`copy size mismatch: ${srcSize} != ${dstSize}`);
  }
  return { size: srcSize, hash: hash.digest('hex') };
}

/** 扫描源目录的 mp4 并关联到专栏书（记录绝对路径，不复制视频） */
async function associateVideos(
  sourceAbs: string,
  bookId: string,
  videoCache: Map<string, VideoFile[]>,
): Promise<number> {
  const sourceDir = path.dirname(sourceAbs);
  let videos = videoCache.get(sourceDir);
  if (!videos) {
    videos = scanVideos(sourceDir);
    videoCache.set(sourceDir, videos);
  }
  if (videos.length === 0) return 0;

  const results = matchVideosToPdfs(
    sourceDir,
    [{ fullPath: sourceAbs, fileName: path.basename(sourceAbs) }],
    videos,
  );
  const result = results[0];
  const matches = result?.matches ?? [];
  const scope = result?.scope || 'lesson';
  let count = 0;
  for (const m of matches) {
    if (!m.selected) continue;
    await prisma.columnVideo.create({
      data: {
        id: nextShortId(),
        bookId,
        title: m.title,
        fileName: m.fileName,
        filePath: m.filePath,
        rootPath: sourceDir,
        relPath: m.fileName,
        lessonNo: m.lessonNo,
        matchScore: m.score,
        scope,
        sortOrder: count,
      },
    });
    count++;
  }
  return count;
}

/**
 * 批量入库（默认拷贝式）。
 * @returns created / skipped / videoCount / mode
 */
export async function importColumnItems(
  items: ColumnImportItem[],
  opts: ColumnImportOptions = {},
): Promise<ColumnImportResult> {
  const targetRoot = path.resolve(opts.targetRoot || DEFAULT_TARGET_ROOT);
  const batchId = opts.batchId || '';
  const overwrite = opts.overwrite === true;
  const mode: 'copy' | 'move' = opts.mode === 'move' ? 'move' : 'copy';

  const created: ColumnImportResult['created'] = [];
  const skipped: ColumnImportResult['skipped'] = [];
  let videoCount = 0;

  const videoCache = new Map<string, VideoFile[]>();

  for (const raw of items) {
    const sourceAbs = path.resolve(String(raw?.filePath || '').trim());
    if (!sourceAbs || !fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
      skipped.push({ filePath: sourceAbs, reason: 'file not found' });
      continue;
    }

    const title = String(raw?.title || path.basename(sourceAbs).replace(/\.pdf$/i, '')).trim();
    const relPath = buildTargetRel(raw, sourceAbs);
    const targetAbs = path.join(targetRoot, ...relPath.split('/'));

    // 1) 源路径去重：同一个源文件此前已搬过 → 直接跳过（拷贝模式下的主要幂等判据）
    const existingSrc = await prisma.columnBook.findFirst({
      where: { isDeleted: false, sourcePath: sourceAbs },
      select: { id: true },
    });
    if (existingSrc) {
      skipped.push({ filePath: sourceAbs, reason: `已迁移过（same source, id=${existingSrc.id}）` });
      continue;
    }

    // 2) 位置去重（无需读盘）
    const existingRel = await prisma.columnBook.findFirst({
      where: { isDeleted: false, rootPath: targetRoot, relPath },
      select: { id: true },
    });
    if (existingRel) {
      skipped.push({ filePath: sourceAbs, reason: `already imported (id=${existingRel.id})` });
      continue;
    }

    // 3) 目标已存在 → 默认跳过（保护已落盘数据）
    if (fs.existsSync(targetAbs) && !overwrite) {
      skipped.push({ filePath: sourceAbs, reason: 'target exists (skip)' });
      continue;
    }

    // 4) 搬运：复制 + 校验（move 模式下稍后再删源）
    fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
    let size: number;
    let hash: string;
    try {
      const r = await copyFileWithHash(sourceAbs, targetAbs);
      size = r.size;
      hash = r.hash;
    } catch (e: any) {
      skipped.push({ filePath: sourceAbs, reason: `copy failed: ${String(e?.message || e).slice(0, 120)}` });
      continue;
    }

    // 5) 内容去重（按 hash）
    if (hash) {
      const dup = await prisma.columnBook.findFirst({
        where: { isDeleted: false, fileHash: hash },
        select: { id: true },
      });
      if (dup) {
        // 已是重复内容：回收刚复制的目标副本，源文件保留（不擅自删用户源盘）
        fs.rmSync(targetAbs, { force: true });
        skipped.push({ filePath: sourceAbs, reason: `duplicate content (id=${dup.id})` });
        continue;
      }
    }

    // 6) 入库
    try {
      const book = await prisma.columnBook.create({
        data: {
          id: nextShortId(),
          title,
          category: raw?.category || path.basename(path.dirname(sourceAbs)),
          grade: String(raw?.grade || ''),
          subject: String(raw?.subject || ''),
          series: String(raw?.series || ''),
          batchId,
          pdfKind: raw?.searchable === 'no_text' ? 'scan' : 'pdf',
          coverPage: 1,
          totalPages: Number(raw?.totalPages) || 0,
          filePath: targetAbs,
          rootPath: targetRoot,
          relPath,
          sourcePath: sourceAbs.slice(0, 768),
          fileSize: size,
          fileHash: hash || (raw?.fileHash ? String(raw.fileHash) : null),
          searchable: String(raw?.searchable || 'ok'),
        },
      });
      created.push({ id: book.id, title: book.title, relPath });

      // 7) move 模式：入库成功后才删源（先落盘、后删源，失败可回滚目标副本）
      if (mode === 'move') {
        try {
          fs.rmSync(sourceAbs, { force: true });
        } catch (e: any) {
          // 删源失败不影响入库结果，记录但不回滚（避免"两头都没有"）
          skipped.push({ filePath: sourceAbs, reason: `imported 但删源失败: ${String(e?.message || e).slice(0, 100)}` });
        }
      }

      // 8) 关联源目录的 mp4
      videoCount += await associateVideos(sourceAbs, book.id, videoCache);
    } catch (e: any) {
      // 入库失败：回收刚复制的目标副本
      fs.rmSync(targetAbs, { force: true });
      skipped.push({ filePath: sourceAbs, reason: `db error: ${String(e?.message || e).slice(0, 160)}` });
    }
  }

  return { created, skipped, videoCount, mode };
}
