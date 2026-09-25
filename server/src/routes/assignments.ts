import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import prisma from '../prisma.js';
import { getBookRoot } from '../services/storage.js';
import { getAvailableDpisAsync } from '../services/pdfProcessor.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const execFileAsync = promisify(execFile);
const router = Router();

// How long a freshly created, still-empty assignment is reused instead of
// creating another one. See the double-submit guard in POST /.
const DUPLICATE_CREATE_WINDOW_MS = 30_000;

function canAccessAssignment(req: AuthedRequest, assignment: { userId: number | null }): boolean {
  if (!req.user) return true; // standalone mode: no restrictions
  if (req.user.isAdmin || req.user.roles.includes('teacher')) return true;
  return assignment.userId === req.user.userId;
}

function canGradeAssignment(req: AuthedRequest): boolean {
  return !req.user || req.user.isAdmin || req.user.roles.includes('teacher');
}

// ── List assignments for a book ──────────────────────────────────

router.get('/', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.query.bookId as string);
  if (isNaN(bookId)) return res.status(400).json({ error: 'bookId required' });

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string) || 50));

  const userId = req.user?.userId;
  const where: any = { bookId };
  const canViewAll = Boolean(req.user?.isAdmin || req.user?.roles.includes('teacher'));
  if (userId && !canViewAll) where.userId = userId;

  const [assignments, total] = await Promise.all([
    prisma.assignment.findMany({
      where,
      select: {
        id: true, bookId: true, userId: true, title: true, subject: true,
        status: true, gradedBy: true, createdAt: true, updatedAt: true, gradedAt: true,
        _count: { select: { strokes: true } },
        strokes: { select: { pageNumber: true }, distinct: 'pageNumber', orderBy: { pageNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.assignment.count({ where }),
  ]);
  res.json({
    data: assignments.map(a => ({
      ...a,
      pages: a.strokes.map(s => s.pageNumber),
      strokes: undefined,
    })),
    total,
    page,
    pageSize,
  });
}));

// ── List assignments across books (home "我的提交" panel) ───────────
// Home needs a cross-book view of *my* work; GET / requires one book at a time.
// Declared before /:id so "mine" is not swallowed as an id.

router.get('/mine', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const take = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 60));
  const bookId = parseInt(req.query.bookId as string);

  // Always scoped to the caller. Teachers/admins see other people's work in
  // /admin/assignments — this endpoint is deliberately personal.
  const userId = req.user?.userId;
  const scope: any = userId ? { userId } : {};

  // An assignment nobody drew on is an empty shell created by opening the
  // assignment mode and walking away; it carries no work to show.
  const shellFilter = {
    OR: [
      { status: { not: 'draft' } },
      { strokes: { some: {} } },
    ],
  };

  // The filter picker is always built from the caller's whole scope, never from
  // the currently selected book — otherwise selecting one book shrinks the list to one.
  // Rows + counts follow the selection so every number on screen is filter-consistent.
  const bookFilter = isNaN(bookId) ? {} : { bookId };
  const where: any = { ...scope, ...shellFilter, ...bookFilter };
  const scopeWhere: any = { ...scope, ...shellFilter };

  const [rows, grouped, bookGroups] = await Promise.all([
    prisma.assignment.findMany({
      where,
      select: {
        id: true, bookId: true, userId: true, title: true, subject: true,
        status: true, gradedBy: true, createdAt: true, updatedAt: true, gradedAt: true,
        _count: { select: { strokes: true } },
        strokes: { select: { pageNumber: true }, distinct: 'pageNumber', orderBy: { pageNumber: 'asc' } },
        book: { select: { id: true, title: true, subject: true, category: true, coverPage: true, totalPages: true, storagePath: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take,
    }),
    prisma.assignment.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
    prisma.assignment.groupBy({
      by: ['bookId'],
      where: scopeWhere,
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ]);

  // Filter options: every book this caller has worked on, most recently touched first.
  const bookMeta = await prisma.book.findMany({
    where: { id: { in: bookGroups.map((g) => g.bookId) } },
    select: { id: true, title: true, subject: true },
  });
  const bookMap = new Map(bookMeta.map((b) => [b.id, b]));
  const books = bookGroups
    .map((g) => ({
      ...bookMap.get(g.bookId),
      id: g.bookId,
      count: g._count._all || 0,
      lastUpdatedAt: g._max.updatedAt,
    }))
    .filter((b) => Boolean(bookMap.get(b.id)))
    .sort((a, b) => (b.lastUpdatedAt?.getTime() || 0) - (a.lastUpdatedAt?.getTime() || 0))
    .map(({ lastUpdatedAt, ...rest }) => rest);

  // Covers live under books/{id}/{dpi}/, so the client needs the dpi list to
  // build a thumbnail URL. Cached per book — repeated assignments share one read.
  const dpiCache = new Map<number, number[]>();
  const data = [];
  for (const a of rows) {
    const bid = a.book?.id;
    let availableDpis: number[] = [];
    if (bid) {
      if (!dpiCache.has(bid)) {
        dpiCache.set(bid, await getAvailableDpisAsync(getBookRoot(bid)).catch(() => []));
      }
      availableDpis = dpiCache.get(bid) || [];
    }
    const { strokes, book, ...rest } = a;
    data.push({
      ...rest,
      pages: strokes.map(s => s.pageNumber),
      book: book ? { ...book, availableDpis } : null,
    });
  }

  const counts = { draft: 0, submitted: 0, graded: 0, returned: 0, all: 0 };
  for (const g of grouped) {
    const n = g._count._all || 0;
    counts.all += n;
    if (g.status in counts) counts[g.status as keyof typeof counts] += n;
  }

  res.json({ data, counts, books, limit: take });
}));

// ── Get assignment detail ─────────────────────────────────────────

router.get('/:id', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: {
      book: { select: { id: true, title: true, storagePath: true, totalPages: true } },
      // Distinct page numbers let the client jump straight to the first page
      // that actually contains strokes (same shape as the list endpoint).
      strokes: { select: { pageNumber: true }, distinct: 'pageNumber', orderBy: { pageNumber: 'asc' } },
    },
  });
  if (!assignment) return res.status(404).json({ error: 'not found' });
  if (!canAccessAssignment(req, assignment)) return res.status(403).json({ error: 'no permission to view this assignment' });
  const { strokes, ...rest } = assignment;
  res.json({ data: { ...rest, pages: strokes.map(s => s.pageNumber) } });
}));

// ── Create assignment ──────────────────────────────────────────────

router.post('/', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.body?.bookId);
  if (isNaN(bookId)) return res.status(400).json({ error: 'bookId required' });

  const userId = req.user?.userId ?? null;
  const title = typeof req.body?.title === 'string' ? req.body.title : '';
  const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return res.status(404).json({ error: 'book not found' });

  // Double-submit guard. A brand new assignment has no strokes yet, so it does
  // not show up on any page — the client's "is there already an assignment on
  // this page?" check cannot see it, and a rapid second click (or a second
  // request from another tab) creates a duplicate empty assignment that is
  // only cleaned up later. Reuse the pending one instead.
  const pending = await prisma.assignment.findFirst({
    where: {
      bookId,
      userId,
      status: 'draft',
      createdAt: { gte: new Date(Date.now() - DUPLICATE_CREATE_WINDOW_MS) },
      strokes: { none: {} },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (pending) return res.json({ data: pending });

  const assignment = await prisma.assignment.create({
    data: { bookId, userId, title: title || book.title, subject: subject || book.subject },
  });
  res.json({ data: assignment });
}));

// ── Update assignment ─────────────────────────────────────────────

router.put('/:id', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);

  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'not found' });

  const userId = req.user?.userId;
  const isOwner = !req.user || assignment.userId === userId;
  if (!isOwner && !canAccessAssignment(req, assignment)) {
    return res.status(403).json({ error: 'no permission to modify this assignment' });
  }

  const data: any = {};
  if (typeof req.body?.title === 'string') data.title = req.body.title;
  if (typeof req.body?.subject === 'string') data.subject = req.body.subject;

  if (typeof req.body?.status === 'string' && ['draft', 'submitted', 'graded', 'returned'].includes(req.body.status)) {
    const newStatus = req.body.status;
    const isTeacher = canGradeAssignment(req);
    const currentStatus = assignment.status;

    // Status transition rules (only enforced when auth is enabled)
    if (req.user) {
      if (isTeacher) {
        // Teacher can move to graded or returned from submitted
        if (newStatus === 'graded' || newStatus === 'returned') {
          if (currentStatus !== 'submitted') {
            return res.status(403).json({ error: '只能批改已提交的作业' });
          }
        } else {
          // Teacher cannot revert to draft/submitted
          return res.status(403).json({ error: '教师不能撤销已批改作业' });
        }
      } else {
        // Student: draft/returned → submitted only
        if (newStatus === 'graded' || newStatus === 'returned') {
          return res.status(403).json({ error: 'only teacher/admin can grade or return assignments' });
        }
        if (newStatus === 'submitted') {
          if (currentStatus !== 'draft' && currentStatus !== 'returned') {
            return res.status(403).json({ error: '当前状态不可提交' });
          }
        } else if (newStatus === 'draft') {
          if (currentStatus !== 'returned') {
            return res.status(403).json({ error: '当前状态不可修改为待提交' });
          }
        }
      }
    }

    if (newStatus === 'graded') {
      data.gradedAt = new Date();
      data.gradedBy = userId || null;
    } else if (newStatus === 'returned') {
      data.gradedAt = null;
      data.gradedBy = null;
    } else {
      data.gradedAt = null;
      data.gradedBy = null;
    }
    data.status = newStatus;
  }

  const updated = await prisma.assignment.update({ where: { id }, data });
  res.json({ data: updated });
}));

// ── Delete assignment ─────────────────────────────────────────────

router.delete('/:id', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);

  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'not found' });

  const userId = req.user?.userId;
  const isOwner = !req.user || assignment.userId === userId;
  if (!isOwner && !canAccessAssignment(req, assignment)) {
    return res.status(403).json({ error: 'no permission to delete this assignment' });
  }

  if (assignment.status === 'submitted' || assignment.status === 'graded') {
    return res.status(403).json({ error: 'cannot delete submitted or graded assignment' });
  }

  await prisma.assignment.delete({ where: { id } }).catch(() => {});
  res.json({ success: true });
}));

// ── Get strokes for a page ────────────────────────────────────────

router.get('/:id/strokes', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const pageNumber = req.query.pageNumber ? parseInt(req.query.pageNumber as string) : undefined;

  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (!canAccessAssignment(req, assignment)) return res.status(403).json({ error: 'no permission to view strokes' });

  const where: any = { assignmentId: id };
  if (pageNumber) where.pageNumber = pageNumber;

  const strokes = await prisma.assignmentStroke.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });
  res.json({ strokes });
}));

// ── Save strokes for a page (replace all) ─────────────────────────

router.post('/:id/strokes', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const pageNumber = parseInt(req.body?.pageNumber);
  const layer = typeof req.body?.layer === 'string' ? req.body.layer : 'student';
  const strokes = Array.isArray(req.body?.strokes) ? req.body.strokes : [];

  if (isNaN(pageNumber)) return res.status(400).json({ error: 'pageNumber required' });

  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (!canAccessAssignment(req, assignment)) return res.status(403).json({ error: 'no permission to modify this assignment' });
  if (assignment.status === 'graded') return res.status(403).json({ error: 'assignment is graded, read-only' });

  // Layer permission enforcement:
  // - Teachers can only write to 'teacher' layer (grading layer)
  // - Students can only write to 'student' layer (answer layer)
  // - Admins can write to any layer
  if (req.user && !req.user.isAdmin) {
    const isTeacher = req.user.roles.includes('teacher');
    if (isTeacher && layer !== 'teacher') {
      return res.status(403).json({ error: 'teachers can only save to teacher layer' });
    }
    if (!isTeacher && layer !== 'student') {
      return res.status(403).json({ error: 'students can only save to student layer' });
    }
  }

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
    // Touch the parent so updatedAt really means "last time this assignment
    // was worked on". Without it the list could only sort by creation time and
    // a draft the student is still drawing on sinks to the bottom of 「我的提交」.
    prisma.assignment.update({ where: { id }, data: { updatedAt: new Date() } }),
  ]);

  res.json({ success: true, count: strokes.length });
}));

// ── Delete a single stroke ────────────────────────────────────────

router.delete('/:id/strokes/:strokeId', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const strokeId = parseInt(req.params.strokeId);
  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (!canAccessAssignment(req, assignment)) return res.status(403).json({ error: 'no permission to modify this assignment' });
  const stroke = await prisma.assignmentStroke.findFirst({ where: { id: strokeId, assignmentId: id } });
  if (!stroke) return res.status(404).json({ error: 'stroke not found' });
  // Layer permission: teachers can only delete teacher-layer strokes, students only student-layer
  if (req.user && !req.user.isAdmin) {
    const isTeacher = req.user.roles.includes('teacher');
    if (isTeacher && stroke.layer !== 'teacher') {
      return res.status(403).json({ error: 'teachers can only delete teacher layer strokes' });
    }
    if (!isTeacher && stroke.layer !== 'student') {
      return res.status(403).json({ error: 'students can only delete student layer strokes' });
    }
  }
  await prisma.assignmentStroke.delete({ where: { id: strokeId } });
  res.json({ success: true });
}));

// ── Export composite JPG ──────────────────────────────────────────

router.post('/:id/export', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const pageNumber = parseInt(req.body?.pageNumber);
  if (isNaN(pageNumber)) return res.status(400).json({ error: 'pageNumber required' });

  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: { book: true },
  });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (!canAccessAssignment(req, assignment)) return res.status(403).json({ error: 'no permission to view this assignment' });

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
}));

export default router;
