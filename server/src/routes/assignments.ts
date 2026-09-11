import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import prisma from '../prisma.js';
import { getBookRoot } from '../services/storage.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const execFileAsync = promisify(execFile);
const router = Router();

function canAccessAssignment(req: AuthedRequest, assignment: { userId: number | null }): boolean {
  if (!req.user) return true; // standalone mode: no restrictions
  if (req.user.isAdmin || req.user.role === 'teacher') return true;
  return assignment.userId === req.user.userId;
}

function canGradeAssignment(req: AuthedRequest): boolean {
  return !req.user || req.user.isAdmin || req.user.role === 'teacher';
}

// ── List assignments for a book ──────────────────────────────────

router.get('/', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.query.bookId as string);
  if (isNaN(bookId)) return res.status(400).json({ error: 'bookId required' });

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string) || 50));

  const userId = req.user?.userId;
  const where: any = { bookId };
  const canViewAll = Boolean(req.user?.isAdmin || req.user?.role === 'teacher');
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

// ── Get assignment detail ─────────────────────────────────────────

router.get('/:id', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseInt(req.params.id);
  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: {
      book: { select: { id: true, title: true, storagePath: true, totalPages: true } },
    },
  });
  if (!assignment) return res.status(404).json({ error: 'not found' });
  if (!canAccessAssignment(req, assignment)) return res.status(403).json({ error: 'no permission to view this assignment' });
  res.json({ assignment });
}));

// ── Create assignment ─────────────────────────────────────────────

router.post('/', authRequired, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseInt(req.body?.bookId);
  if (isNaN(bookId)) return res.status(400).json({ error: 'bookId required' });

  const userId = req.user?.userId ?? null;
  const title = typeof req.body?.title === 'string' ? req.body.title : '';
  const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) return res.status(404).json({ error: 'book not found' });

  const assignment = await prisma.assignment.create({
    data: { bookId, userId, title: title || book.title, subject: subject || book.subject },
  });
  res.json({ assignment });
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
            return res.status(403).json({ error: '当前状态不可修改为草稿' });
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
  res.json({ assignment: updated });
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
    const isTeacher = req.user.role === 'teacher';
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
    const isTeacher = req.user.role === 'teacher';
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
