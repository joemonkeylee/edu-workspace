import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import prisma from '../prisma.js';
import { getBookRoot } from '../services/storage.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';

const execFileAsync = promisify(execFile);
const router = Router();

// ── List assignments for a book ──────────────────────────────────

router.get('/', authRequired, async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.query.bookId as string);
  if (isNaN(bookId)) return res.status(400).json({ error: 'bookId required' });

  const assignments = await prisma.assignment.findMany({
    where: { bookId },
    select: {
      id: true, bookId: true, userId: true, title: true, subject: true,
      status: true, gradedBy: true, createdAt: true, updatedAt: true, gradedAt: true,
      _count: { select: { strokes: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ assignments });
});

// ── Get assignment detail ─────────────────────────────────────────

router.get('/:id', authRequired, async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: {
      book: { select: { id: true, title: true, storagePath: true, totalPages: true } },
    },
  });
  if (!assignment) return res.status(404).json({ error: 'not found' });
  res.json({ assignment });
});

// ── Create assignment ─────────────────────────────────────────────

router.post('/', authRequired, async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.body?.bookId);
  if (isNaN(bookId)) return res.status(400).json({ error: 'bookId required' });

  const userId = req.user?.userId || 0;
  const title = typeof req.body?.title === 'string' ? req.body.title : '';
  const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return res.status(404).json({ error: 'book not found' });

  const assignment = await prisma.assignment.create({
    data: { bookId, userId, title: title || book.title, subject: subject || book.subject },
  });
  res.json({ assignment });
});

// ── Update assignment ─────────────────────────────────────────────

router.put('/:id', authRequired, async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const data: any = {};
  if (typeof req.body?.title === 'string') data.title = req.body.title;
  if (typeof req.body?.subject === 'string') data.subject = req.body.subject;
  if (typeof req.body?.status === 'string' && ['draft', 'graded'].includes(req.body.status)) {
    data.status = req.body.status;
    if (req.body.status === 'graded') {
      data.gradedAt = new Date();
      data.gradedBy = req.user?.userId || null;
    } else {
      data.gradedAt = null;
      data.gradedBy = null;
    }
  }

  const assignment = await prisma.assignment.update({ where: { id }, data });
  res.json({ assignment });
});

// ── Delete assignment ─────────────────────────────────────────────

router.delete('/:id', authRequired, async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.assignment.delete({ where: { id } }).catch(() => {});
  res.json({ success: true });
});

// ── Get strokes for a page ────────────────────────────────────────

router.get('/:id/strokes', authRequired, async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const pageNumber = req.query.pageNumber ? parseInt(req.query.pageNumber as string) : undefined;

  const where: any = { assignmentId: id };
  if (pageNumber) where.pageNumber = pageNumber;

  const strokes = await prisma.assignmentStroke.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });
  res.json({ strokes });
});

// ── Save strokes for a page (replace all) ─────────────────────────

router.post('/:id/strokes', authRequired, async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const pageNumber = parseInt(req.body?.pageNumber);
  const layer = typeof req.body?.layer === 'string' ? req.body.layer : 'student';
  const strokes = Array.isArray(req.body?.strokes) ? req.body.strokes : [];

  if (isNaN(pageNumber)) return res.status(400).json({ error: 'pageNumber required' });

  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (assignment.status === 'graded') return res.status(403).json({ error: 'assignment is graded, read-only' });

  // Delete existing strokes for this page+layer
  await prisma.assignmentStroke.deleteMany({
    where: { assignmentId: id, pageNumber, layer },
  });

  // Insert new strokes
  if (strokes.length > 0) {
    await prisma.assignmentStroke.createMany({
      data: strokes.map((s: any) => ({
        assignmentId: id,
        pageNumber,
        layer,
        tool: s.tool || 'pen',
        color: s.color || '#000000',
        width: s.width || 2,
        points: s.points || [],
      })),
    });
  }

  res.json({ success: true, count: strokes.length });
});

// ── Delete a single stroke ────────────────────────────────────────

router.delete('/:id/strokes/:strokeId', authRequired, async (req: AuthedRequest, res: Response) => {
  const strokeId = parseInt(req.params.strokeId);
  await prisma.assignmentStroke.delete({ where: { id: strokeId } }).catch(() => {});
  res.json({ success: true });
});

// ── Export composite JPG ──────────────────────────────────────────

router.post('/:id/export', authRequired, async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const pageNumber = parseInt(req.body?.pageNumber);
  if (isNaN(pageNumber)) return res.status(400).json({ error: 'pageNumber required' });

  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: { book: true },
  });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });

  // Export endpoint returns a JSON with the page image URL and strokes
  // The actual compositing happens on the client side (canvas)
  // This endpoint just gathers the data needed
  const strokes = await prisma.assignmentStroke.findMany({
    where: { assignmentId: id, pageNumber },
    orderBy: { createdAt: 'asc' },
  });

  const storagePath = assignment.book.storagePath || '';
  const paddedPage = String(pageNumber).padStart(4, '0');
  const pageImage = `${storagePath}page-${paddedPage}.png`;

  res.json({
    pageImage,
    strokes,
    assignment: { id: assignment.id, title: assignment.title, status: assignment.status },
  });
});

export default router;
