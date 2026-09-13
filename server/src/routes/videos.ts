import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../prisma.js';
import { authRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

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

export default router;
