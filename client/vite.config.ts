import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * 「错题本样例」本地资源中间件。
 *
 * 11 个 PDF 共 600MB+，既不能进 git，也不能进 public/（vite build 会把 public
 * 整份复制到 dist，等于把 600MB 打进部署产物）。所以文件放在仓库内、被 .gitignore
 * 排除的 client/wrong-demo-assets/，只在 dev 与 preview 下由这个中间件映射出去。
 *
 * 必须支持 Range：pdf.js 靠 Range 请求按需拉取，没有它就退化成整包下载，
 * 单本最大 94MB 会卡到没法用。
 */
const MOUNT = '/wrong-demo/';
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** 解析 `bytes=start-end` / `bytes=start-` / `bytes=-suffix`，非法或越界返回 null */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;

  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    // 末尾 N 字节
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function wrongDemoAssets(): Plugin {
  const assetDir = path.resolve(__dirname, 'wrong-demo-assets');

  const middleware = (
    req: { url?: string; headers: Record<string, string | string[] | undefined>; method?: string },
    res: any,
    next: () => void,
  ) => {
    const url = req.url;
    if (!url || !url.startsWith(MOUNT)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // 去掉挂载前缀与查询串，再解码（文件名保持 ASCII，解码只为稳妥）
    const rel = decodeURIComponent(url.slice(MOUNT.length).split('?')[0]);
    const filePath = path.resolve(assetDir, rel);

    // 目录穿越防护：解析后的路径必须仍在资源目录内
    if (filePath !== assetDir && !filePath.startsWith(assetDir + path.sep)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(`Not found: ${MOUNT}${rel}\n\n请确认 client/wrong-demo-assets/ 下存在该文件。`);
        return;
      }

      const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      res.setHeader('Content-Type', type);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');

      const rangeHeader = req.headers.range;
      const range = typeof rangeHeader === 'string' ? parseRange(rangeHeader, stat.size) : null;

      if (range) {
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
        res.setHeader('Content-Length', range.end - range.start + 1);
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Length', stat.size);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath).pipe(res);
    });
  };

  return {
    name: 'wrong-demo-local-assets',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), wrongDemoAssets()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5678,
    proxy: {
      '/api': 'http://localhost:4001',
      '/storage': 'http://localhost:4001',
      '/data': 'http://182.92.129.222',
      '/lt': 'http://182.92.129.222',
    },
  },
});
