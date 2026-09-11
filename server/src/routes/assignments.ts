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

  // Filter by userId when auth is enabled (data isolation)
  const userId = req.user?.userId;
  const where: any = { bookId };
  if (userId) where.userId = userId;

  const assignments = await prisma.assignment.findMany({
    where,
    select: {
      id: true, bookId: true, userId: true, title: true, subject: true,
      status: true, gradedBy: true, createdAt: true, updatedAt: true, gradedAt: true,
      _count: { select: { strokes: true } },
      strokes: { select: { pageNumber: true }, distinct: 'pageNumber', orderBy: { pageNumber: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    assignments: assignments.map(a => ({
      ...a,
      pages: a.strokes.map(s => s.pageNumber),
      strokes: undefined,
    })),
  });
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

  // Fetch assignment for ownership check
  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'not found' });

  // Ownership check: when auth is enabled, only owner or admin can modify
  const userId = req.user?.userId;
  const isOwner = !userId || assignment.userId === userId || assignment.userId === 0;
  const isAdmin = req.user?.isAdmin;
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'no permission to modify this assignment' });
  }

  const data: any = {};
  if (typeof req.body?.title === 'string') data.title = req.body.title;
  if (typeof req.body?.subject === 'string') data.subject = req.body.subject;

  // Status flow: students can only draft→submitted; graded/returned require admin
  if (typeof req.body?.status === 'string' && ['draft', 'submitted', 'graded', 'returned'].includes(req.body.status)) {
    const newStatus = req.body.status;
    const isTeacher = isAdmin;

    if (newStatus === 'graded' || newStatus === 'returned') {
      if (!isTeacher) {
        return res.status(403).json({ error: 'only teacher/admin can grade or return assignments' });
      }
      data.gradedAt = newStatus === 'graded' ? new Date() : null;
      data.gradedBy = userId || null;
    } else {
      // draft / submitted — student can set, but only for their own assignment
      data.gradedAt = null;
      data.gradedBy = null;
    }
    data.status = newStatus;
  }

  const updated = await prisma.assignment.update({ where: { id }, data });
  res.json({ assignment: updated });
});

// ── Delete assignment ─────────────────────────────────────────────

router.delete('/:id', authRequired, async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);

  // Ownership check
  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'not found' });

  const userId = req.user?.userId;
  const isOwner = !userId || assignment.userId === userId || assignment.userId === 0;
  const isAdmin = req.user?.isAdmin;
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'no permission to delete this assignment' });
  }

  // Only draft or returned assignments can be deleted
  if (assignment.status === 'submitted' || assignment.status === 'graded') {
    return res.status(403).json({ error: 'cannot delete submitted or graded assignment' });
  }

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

  // Delete existing + insert new strokes atomically
  await prisma.$transaction([
    prisma.assignmentStroke.deleteMany({
      where: { assignmentId: id, pageNumber, layer },
    }),
    ...(strokes.length > 0 ? [prisma.assignmentStroke.createMany({
      data: strokes.map((s: any) => ({
        assignmentId: id,
        pageNumber,
        layer,
        tool: s.tool || 'pen',
        color: s.color || '#000000',
        width: s.width || 2,
        points: s.points || [],
      })),
    })] : []),
  ]);

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
