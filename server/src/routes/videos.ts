import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { WATCHED_RATIO, bookReadiness, toProgressInfo, upsertProgress } from '../services/videoProgress.js';

const router = Router();

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
};

function contentTypeOf(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * 讲解视频流式播放。
 * 只记录原始绝对路径、不复制文件，因此支持 HTTP Range —— 否则浏览器无法拖动进度条。
 */
router.get('/:id/stream', authRequired, asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '视频 ID 非法' });
    return;
  }

  const video = await prisma.bookVideo.findUnique({ where: { id } });
  if (!video) {
    res.status(404).json({ error: '视频不存在' });
    return;
  }

  if (!fs.existsSync(video.filePath)) {
    if (!video.missing) {
      await prisma.bookVideo.update({ where: { id }, data: { missing: true } }).catch(() => {});
    }
    res.status(404).json({ error: '视频文件不存在，可能资源目录已被移动' });
    return;
  }

  const stat = fs.statSync(video.filePath);
  const fileSize = stat.size;
  const contentType = contentTypeOf(video.filePath);

  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(video.filePath).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
    res.writeHead(416, {
      'Content-Range': `bytes */${fileSize}`,
      'Content-Type': contentType,
    });
    res.end();
    return;
  }

  const chunkEnd = Math.min(end, fileSize - 1);
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${chunkEnd}/${fileSize}`,
    'Content-Length': chunkEnd - start + 1,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(video.filePath, { start, end: chunkEnd }).pipe(res);
}));

/**
 * 上报播放进度（播放器每几秒 / 暂停时调用）。
 * 进度按视频身份（relPath）记录，因此同一个视频被多本教材引用时进度共享。
 * 播放比例达到 WATCHED_RATIO 时自动置为「已看完」；「已完成」只能手动标记。
 */
router.put('/:id/progress', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '视频 ID 非法' });
    return;
  }
  const video = await prisma.bookVideo.findUnique({ where: { id } });
  if (!video) {
    res.status(404).json({ error: '视频不存在' });
    return;
  }

  const positionSec = Math.max(0, Number(req.body?.positionSec) || 0);
  const durationSec = Math.max(0, Number(req.body?.durationSec) || 0);
  const watched = durationSec > 0 && positionSec / durationSec >= WATCHED_RATIO;

  const data: { positionSec: number; lastViewedAt: Date; durationSec?: number; watched?: boolean } = {
    positionSec,
    lastViewedAt: new Date(),
  };
  if (durationSec > 0) data.durationSec = durationSec;
  if (watched) data.watched = true;

  const saved = await upsertProgress(video.relPath, req.user?.userId ?? null, data);
  res.json({ data: toProgressInfo(saved) });
}));

/**
 * 手动标记 / 取消「已完成」。
 * 标记为完成需要满足：该书的作业全部做完（已提交/已批改）且错题全部整理完；
 * 取消完成则不受限制。
 */
router.post('/:id/complete', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '视频 ID 非法' });
    return;
  }
  const video = await prisma.bookVideo.findUnique({ where: { id } });
  if (!video) {
    res.status(404).json({ error: '视频不存在' });
    return;
  }

  const completed = Boolean(req.body?.completed);
  const bookId = Number(req.body?.bookId) || video.bookId;

  if (completed) {
    const readiness = await bookReadiness(bookId, req.user);
    if (!readiness.ready) {
      res.status(409).json({
        error: `还不能标记完成：作业 ${readiness.assignmentsDone}/${readiness.assignmentsTotal}、错题 ${readiness.mistakesDone}/${readiness.mistakesTotal}`,
      });
      return;
    }
  }

  const saved = await upsertProgress(video.relPath, req.user?.userId ?? null, {
    completed,
    completedAt: completed ? new Date() : null,
  });
  res.json({ data: toProgressInfo(saved) });
}));

export default router;
