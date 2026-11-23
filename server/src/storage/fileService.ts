import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import type { Request, Response } from 'express';
import express from 'express';

const MIME_TYPES: Record<string, string> = {
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

interface ByteRange {
  start: number;
  end: number;
}

interface FileServiceOptions {
  root: string;
  token: string;
  maxUploadBytes?: number;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function resolveObjectPath(rootPath: string, key: string): string {
  if (!key || key.length > 1024 || key.startsWith('/') || key.includes('\\') || /[\0-\x1f\x7f]/.test(key)) {
    throw Object.assign(new Error('invalid object key'), { status: 400 });
  }
  const parts = key.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw Object.assign(new Error('invalid object key'), { status: 400 });
  }
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, ...parts);
  if (!isWithinRoot(root, resolved)) {
    throw Object.assign(new Error('invalid object key'), { status: 400 });
  }
  return resolved;
}

function assertNoSymlinkSegments(root: string, target: string) {
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw Object.assign(new Error('symbolic links are not allowed in object paths'), { status: 400 });
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

function parseRange(value: string | undefined, size: number): ByteRange | null | false {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}

function keyFromRequest(req: Request): string {
  const key = req.params[0];
  if (typeof key !== 'string') throw Object.assign(new Error('object key required'), { status: 400 });
  return key;
}

function constantTimeTokenMatch(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function sendFile(req: Request, res: Response, filePath: string, headOnly = false) {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return res.status(404).json({ error: 'object not found' });
    throw error;
  }
  if (!stat.isFile()) return res.status(404).json({ error: 'object not found' });

  const range = parseRange(req.headers.range, stat.size);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(range ? range.end - range.start + 1 : stat.size));
  res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('ETag', `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`);
  if (range === false) {
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    return res.status(416).end();
  }
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
  } else {
    res.status(200);
  }
  if (headOnly) return res.end();

  const streamOptions = range ? { start: range.start, end: range.end } : undefined;
  const stream = fs.createReadStream(filePath, streamOptions);
  stream.on('error', (error) => {
    if (!res.headersSent) res.status(500).json({ error: 'failed to read object' });
    else res.destroy(error);
  });
  stream.pipe(res);
}

export function createFileServiceApp({ root, token, maxUploadBytes = 20 * 1024 * 1024 * 1024 }: FileServiceOptions) {
  if (token.length < 32) throw new Error('FILE_SERVICE_TOKEN must be at least 32 characters');
  const resolvedRoot = path.resolve(root);
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/v1', (req, res, next) => {
    const authorization = req.headers.authorization;
    const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!constantTimeTokenMatch(token, provided)) {
      return res.status(401).json({ error: 'service authentication required' });
    }
    next();
  });

  app.post('/v1/initialize', (_req, res, next) => {
    try {
      for (const relative of ['pdf/books', 'pdf/covers', 'pdf/thumbs', 'pdf/crops']) {
        fs.mkdirSync(path.join(resolvedRoot, ...relative.split('/')), { recursive: true });
      }
      const probe = path.join(resolvedRoot, `.write-check-${crypto.randomUUID()}`);
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      res.json({ data: { initialized: true, writable: true } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/status', (_req, res) => {
    let writable = false;
    try {
      fs.accessSync(resolvedRoot, fs.constants.W_OK);
      writable = true;
    } catch { /* report unavailable to the caller */ }
    res.json({ data: { initialized: fs.existsSync(resolvedRoot), writable } });
  });

  app.get('/v1/objects', (req, res, next) => {
    try {
      const rawPrefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
      const prefix = rawPrefix.replace(/\/+$/, '');
      if (prefix) resolveObjectPath(resolvedRoot, prefix);
      const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
      const entries: Array<{ key: string; size: number; lastModified: string }> = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.isSymbolicLink()) walk(abs);
          else if (entry.isFile()) {
            const key = path.relative(resolvedRoot, abs).split(path.sep).join('/');
            if (key.startsWith(prefix) && key > cursor) {
              const stat = fs.statSync(abs);
              entries.push({ key, size: stat.size, lastModified: stat.mtime.toISOString() });
            }
          }
        }
      };
      if (!fs.existsSync(resolvedRoot)) return res.json({ data: [], nextCursor: null });
      walk(resolvedRoot);
      entries.sort((a, b) => a.key.localeCompare(b.key));
      const page = entries.slice(0, limit);
      res.json({ data: page, nextCursor: entries.length > limit ? page[page.length - 1]?.key ?? null : null });
    } catch (error) {
      next(error);
    }
  });

  app.put('/v1/objects/*', async (req, res, next) => {
    let tempPath = '';
    try {
      const key = keyFromRequest(req);
      const destination = resolveObjectPath(resolvedRoot, key);
      const parent = path.dirname(destination);
      fs.mkdirSync(parent, { recursive: true });
      assertNoSymlinkSegments(resolvedRoot, parent);
      const overwrite = req.headers['x-overwrite'] === 'true';
      if (fs.existsSync(destination) && !overwrite) return res.status(409).json({ error: 'object already exists' });

      const declaredLength = Number(req.headers['content-length'] || 0);
      if (declaredLength > maxUploadBytes) return res.status(413).json({ error: 'upload too large' });

      tempPath = path.join(parent, `.upload-${crypto.randomUUID()}`);
      const hash = crypto.createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size > maxUploadBytes) return callback(Object.assign(new Error('upload too large'), { status: 413 }));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(req, meter, fs.createWriteStream(tempPath, { flags: 'wx' }));
      if (fs.existsSync(destination)) {
        if (!overwrite) {
          fs.rmSync(tempPath, { force: true });
          tempPath = '';
          return res.status(409).json({ error: 'object already exists' });
        }
        const previousPath = path.join(parent, `.previous-${crypto.randomUUID()}`);
        fs.renameSync(destination, previousPath);
        try {
          fs.renameSync(tempPath, destination);
          tempPath = '';
        } catch (error) {
          fs.renameSync(previousPath, destination);
          throw error;
        }
        try {
          fs.rmSync(previousPath, { force: true });
        } catch (cleanupError) {
          console.error(`[file-service] failed to remove replaced object backup: ${previousPath}`, cleanupError);
        }
      } else {
        fs.renameSync(tempPath, destination);
        tempPath = '';
      }
      res.status(201).json({ data: { key, size, sha256: hash.digest('hex') } });
    } catch (error: any) {
      if (tempPath) {
        try { fs.rmSync(tempPath, { force: true }); } catch (cleanupError) { console.warn('[file-service] upload cleanup failed', cleanupError); }
      }
      if (error?.message === 'upload too large') return res.status(413).json({ error: 'upload too large' });
      next(error);
    }
  });

  app.head('/v1/objects/*', (req, res, next) => {
    try {
      const key = keyFromRequest(req);
      const target = resolveObjectPath(resolvedRoot, key);
      assertNoSymlinkSegments(resolvedRoot, target);
      return sendFile(req, res, target, true);
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/objects/*', (req, res, next) => {
    try {
      const key = keyFromRequest(req);
      const target = resolveObjectPath(resolvedRoot, key);
      assertNoSymlinkSegments(resolvedRoot, target);
      return sendFile(req, res, target);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/v1/objects/*', (req, res, next) => {
    try {
      const key = keyFromRequest(req);
      const filePath = resolveObjectPath(resolvedRoot, key);
      assertNoSymlinkSegments(resolvedRoot, filePath);
      try {
        fs.unlinkSync(filePath);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: any, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('[file-service] request failed:', error);
    const status = Number(error?.status);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: error?.message || 'internal server error' });
  });

  return app;
}
