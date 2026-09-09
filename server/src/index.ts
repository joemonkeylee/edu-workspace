import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';

import adminRouter from './routes/admin.js';
import adminBooksRouter from './routes/adminBooks.js';
import adminAnnotationsRouter from './routes/adminAnnotations.js';
import adminMistakesRouter from './routes/adminMistakes.js';
import adminUsersRouter from './routes/adminUsers.js';
import authRouter from './routes/auth.js';
import booksRouter from './routes/books.js';
import annotationsRouter from './routes/annotations.js';
import mistakesRouter from './routes/mistakes.js';
import assignmentsRouter from './routes/assignments.js';
import { getStorageRoot, initializeStorageRoot } from './services/storage.js';
import { isAuthEnabled } from './services/auth.js';

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(compression());
app.use(cors({
  origin: CLIENT_ORIGINS.includes('*') ? true : CLIENT_ORIGINS,
}));
app.use(express.json({ limit: '50mb' }));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/books', adminBooksRouter);
app.use('/api/admin/annotations', adminAnnotationsRouter);
app.use('/api/admin/mistakes', adminMistakesRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/books', booksRouter);
app.use('/api/annotations', annotationsRouter);
app.use('/api/mistakes', mistakesRouter);
app.use('/api/assignments', assignmentsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function start() {
  await initializeStorageRoot();
  fs.mkdirSync(getStorageRoot(), { recursive: true });
  app.use('/storage', (req, res, next) => express.static(getStorageRoot())(req, res, next));
  app.listen(PORT, () => {
    console.log(`[edu-workspace] 后端服务已启动: http://localhost:${PORT}`);
    console.log(`[edu-workspace] 认证: ${isAuthEnabled() ? '启用' : '未启用'}`);
  });
}

start().catch((error) => {
  console.error('[edu-workspace] 后端启动失败:', error);
  process.exit(1);
});
