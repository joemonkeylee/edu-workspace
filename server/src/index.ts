import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';

import adminRouter from './routes/admin.js';
import adminBooksRouter from './routes/adminBooks.js';
import adminAnnotationsRouter from './routes/adminAnnotations.js';
import adminMistakesRouter from './routes/adminMistakes.js';
import adminUsersRouter from './routes/adminUsers.js';
import adminAssignmentsRouter from './routes/adminAssignments.js';
import adminBookPairsRouter from './routes/adminBookPairs.js';
import adminDbBackupsRouter from './routes/adminDbBackups.js';
import adminVideosRouter from './routes/adminVideos.js';
import videosRouter from './routes/videos.js';
import authRouter from './routes/auth.js';
import booksRouter from './routes/books.js';
import annotationsRouter from './routes/annotations.js';
import mistakesRouter from './routes/mistakes.js';
import assignmentsRouter from './routes/assignments.js';
import readingProgressRouter from './routes/readingProgress.js';
// PDF 原生模块（feature/pdf-native）——独立命名空间，与上面既有路由完全并行
import pdfRouter from './pdf/index.js';
import { ensurePdfDirs } from './pdf/services/pdfStorage.js';
import { getStorageRoot, initializeStorageRoot } from './services/storage.js';
import { isAuthEnabled } from './services/auth.js';
import { cropsAuthMiddleware } from './middleware/cropsAuth.js';
import { startBackupScheduler } from './services/dbBackupScheduler.js';

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(compression());
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: CLIENT_ORIGINS.includes('*') ? true : CLIENT_ORIGINS,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

// Rate limit login endpoint
const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: '请求过于频繁，请稍后再试' },
});

app.use('/api/auth/login', loginLimiter);

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/books', adminBooksRouter);
app.use('/api/admin/annotations', adminAnnotationsRouter);
app.use('/api/admin/mistakes', adminMistakesRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/admin/assignments', adminAssignmentsRouter);
app.use('/api/admin/book-pairs', adminBookPairsRouter);
app.use('/api/admin/db-backups', adminDbBackupsRouter);
app.use('/api/admin/videos', adminVideosRouter);
app.use('/api/videos', videosRouter);
app.use('/api/books', booksRouter);
app.use('/api/annotations', annotationsRouter);
app.use('/api/mistakes', mistakesRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/reading-progress', readingProgressRouter);

// PDF 原生模块：全部挂在 /api/pdf 之下，不触碰任何既有路由
app.use('/api/pdf', pdfRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled error]', err);
  const code = err?.code || '';
  let status = 500;
  if (code === 'P2002') status = 409;
  else if (code === 'P2025') status = 404;
  res.status(status).json({
    success: false,
    error: err?.message || 'internal server error',
    code: code || undefined,
  });
});

async function start() {
  await initializeStorageRoot();
  // PDF 模块自己的存储目录（storage/pdf），失败不阻塞启动
  try {
    ensurePdfDirs();
  } catch (e) {
    console.warn('[edu-workspace] pdf storage dirs init failed:', e);
  }
  // Protect crop images with auth middleware
  app.use('/storage/crops', cropsAuthMiddleware);
  app.use('/storage', (req, res, next) => express.static(getStorageRoot())(req, res, next));
  app.listen(PORT, async () => {
    console.log(`[edu-workspace] 后端服务已启动: http://localhost:${PORT}`);
    console.log(`[edu-workspace] 认证: ${isAuthEnabled() ? '启用' : '未启用'}`);
    // Start auto backup scheduler (after server is up so DB is ready)
    try {
      await startBackupScheduler();
    } catch (e) {
      console.warn('[edu-workspace] auto backup scheduler failed to start:', e);
    }
  });
}

start().catch((error) => {
  console.error('[edu-workspace] 后端启动失败:', error);
  process.exit(1);
});
