import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

import adminRouter from './routes/admin.js';
import adminBooksRouter from './routes/adminBooks.js';
import adminAnnotationsRouter from './routes/adminAnnotations.js';
import adminMistakesRouter from './routes/adminMistakes.js';
import booksRouter from './routes/books.js';
import annotationsRouter from './routes/annotations.js';
import mistakesRouter from './routes/mistakes.js';

const app = express();
const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: '50mb' }));

const STORAGE_ABS = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');
fs.mkdirSync(STORAGE_ABS, { recursive: true });
app.use('/storage', express.static(STORAGE_ABS));

app.use('/api/admin', adminRouter);
app.use('/api/admin/books', adminBooksRouter);
app.use('/api/admin/annotations', adminAnnotationsRouter);
app.use('/api/admin/mistakes', adminMistakesRouter);
app.use('/api/books', booksRouter);
app.use('/api/annotations', annotationsRouter);
app.use('/api/mistakes', mistakesRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[edu-workspace] 后端服务已启动: http://localhost:${PORT}`);
});
