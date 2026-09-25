import { Router } from 'express';
import pdfBooksRouter from './routes/pdfBooks.js';
import pdfScanRouter from './routes/pdfScan.js';
import pdfUserStateRouter from './routes/pdfUserState.js';
import pdfAnnotationsRouter from './routes/pdfAnnotations.js';
import pdfMistakesRouter from './routes/pdfMistakes.js';
import pdfAssignmentsRouter from './routes/pdfAssignments.js';

/**
 * PDF 原生模块的入口路由，整体挂载在 /api/pdf 之下。
 *
 * 这是一个与既有 /api/* 完全并行的独立命名空间：
 * 既有的 /api/books、/api/annotations、/api/assignments 等路由一行都不改动。
 */
const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', module: 'pdf', timestamp: new Date().toISOString() });
});

router.use('/books', pdfBooksRouter);
router.use('/admin', pdfScanRouter);
router.use('/annotations', pdfAnnotationsRouter);
router.use('/mistakes', pdfMistakesRouter);
router.use('/assignments', pdfAssignmentsRouter);
// 收藏 / 阅读进度：/api/pdf/favorites/*、/api/pdf/reading-progress/*
router.use('/', pdfUserStateRouter);

export default router;
