import { Router, Response } from 'express';
import prisma from '../../prisma.js';
import { authRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * PDF 域的作业 / 笔迹 / 批改（/api/pdf/assignments）。
 *
 * 契约与既有 /api/assignments 一致，写入 pdf_assignment / pdf_assignment_stroke。
 * 关键差异在导出：图片模式要服务端返回 page 图路径让前端合成，
 * PDF 模式下画笔迹覆盖 layer 后直接从同一个 canvas 出图即可，
 * 所以 /export 只返回余下所需信息，不再需要拼 PNG 路径。
 */
const router = Router();
router.use(authRequired);

// 新建后多久内的空白作业会被复用，防止双击产生重复空作业
const DUPLICATE_CREATE_WINDOW_MS = 30_000;

function parseIntParam(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function getUserId(req: AuthedRequest): number | null {
  return typeof req.user?.userId === 'number' ? req.user.userId : null;
}

function canAccess(req: AuthedRequest, assignment: { userId: number | null }): boolean {
  if (!req.user) return true; // standalone
  if (req.user.isAdmin || req.user.roles.includes('teacher')) return true;
  return assignment.userId === req.user.userId;
}

function canGrade(req: AuthedRequest): boolean {
  return !req.user || req.user.isAdmin || req.user.roles.includes('teacher');
}

// ─────────────────────────────────────────────────────────────
// 列表 / 详情 / 创建
// ─────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseIntParam(req.query.bookId, NaN);
  if (!Number.isFinite(bookId)) return res.status(400).json({ error: 'bookId required' });

  const page = Math.max(1, parseIntParam(req.query.page, 1));
  const pageSize = Math.min(200, Math.max(1, parseIntParam(req.query.pageSize, 50)));

  const userId = getUserId(req);
  const canViewAll = Boolean(req.user?.isAdmin || req.user?.roles.includes('teacher'));
  const where: any = { bookId };
  if (userId && !canViewAll) where.userId = userId;

  const [rows, total] = await Promise.all([
    prisma.pdfAssignment.findMany({
      where,
      select: {
        id: true, bookId: true, userId: true, title: true, subject: true,
        status: true, gradedBy: true, createdAt: true, updatedAt: true, gradedAt: true,
        _count: { select: { strokes: true } },
        strokes: { select: { pageNumber: true }, distinct: ['pageNumber'], orderBy: { pageNumber: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pdfAssignment.count({ where }),
  ]);

  res.json({
    data: rows.map((a: any) => ({ ...a, pages: a.strokes.map((s: any) => s.pageNumber), strokes: undefined })),
    total,
    page,
    pageSize,
  });
}));

router.get('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const assignment = await prisma.pdfAssignment.findUnique({
    where: { id },
    include: {
      book: { select: { id: true, title: true, totalPages: true, pageSizes: true } },
      strokes: { select: { pageNumber: true }, distinct: ['pageNumber'], orderBy: { pageNumber: 'asc' } },
    },
  });
  if (!assignment) return res.status(404).json({ error: 'not found' });
  if (!canAccess(req, assignment)) return res.status(403).json({ error: 'no permission to view this assignment' });

  const { strokes, ...rest } = assignment as any;
  res.json({ data: { ...rest, pages: strokes.map((s: any) => s.pageNumber) } });
}));

router.post('/', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const bookId = parseIntParam(req.body?.bookId, NaN);
  if (!Number.isFinite(bookId)) return res.status(400).json({ error: 'bookId required' });

  const book = await prisma.pdfBook.findFirst({ where: { id: bookId, isDeleted: false } });
  if (!book) return res.status(404).json({ error: 'pdf book not found' });

  const userId = getUserId(req);
  const title = typeof req.body?.title === 'string' ? req.body.title : '';
  const subject = typeof req.body?.subject === 'string' ? req.body.subject : '';

  // 双击/多标签页会连发两次请求，而空白作业不在任何页上出现，
  // 客户端无从判断重 —— 这里直接复用窗口内的空白草稿。
  const pending = await prisma.pdfAssignment.findFirst({
    where: {
      bookId,
      userId,
      status: 'draft',
      createdAt: { gte: new Date(Date.now() - DUPLICATE_CREATE_WINDOW_MS) },
      strokes: { none: {} },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (pending) return res.json({ data: { ...pending, pages: [] } });

  const assignment = await prisma.pdfAssignment.create({
    data: { bookId, userId, title: title || book.title, subject: subject || book.subject },
  });
  res.json({ data: { ...assignment, pages: [] } });
}));

// ─────────────────────────────────────────────────────────────
// 更新 / 删除
// ─────────────────────────────────────────────────────────────

router.put('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const assignment = await prisma.pdfAssignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'not found' });

  const userId = getUserId(req);
  const isOwner = !req.user || assignment.userId === userId;
  if (!isOwner && !canAccess(req, assignment)) {
    return res.status(403).json({ error: 'no permission to modify this assignment' });
  }

  const data: any = {};
  if (typeof req.body?.title === 'string') data.title = req.body.title;
  if (typeof req.body?.subject === 'string') data.subject = req.body.subject;

  if (typeof req.body?.status === 'string' && ['draft', 'submitted', 'graded', 'returned'].includes(req.body.status)) {
    const newStatus = req.body.status;
    const isTeacher = canGrade(req);
    const currentStatus = assignment.status;

    if (req.user) {
      if (isTeacher) {
        if (newStatus === 'graded' || newStatus === 'returned') {
          if (currentStatus !== 'submitted') {
            return res.status(403).json({ error: '只能批改已提交的作业' });
          }
        } else {
          return res.status(403).json({ error: '教师不能撤销已批改作业' });
        }
      } else {
        if (newStatus === 'graded' || newStatus === 'returned') {
          return res.status(403).json({ error: 'only teacher/admin can grade or return assignments' });
        }
        if (newStatus === 'submitted') {
          if (currentStatus !== 'draft' && currentStatus !== 'returned') {
            return res.status(403).json({ error: '当前状态不可提交' });
          }
        } else if (newStatus === 'draft' && currentStatus !== 'returned') {
          return res.status(403).json({ error: '当前状态不可修改为待提交' });
        }
      }
    }

    data.gradedAt = newStatus === 'graded' ? new Date() : null;
    data.gradedBy = newStatus === 'graded' ? (userId || null) : null;
    data.status = newStatus;
  }

  const updated = await prisma.pdfAssignment.update({ where: { id }, data });
  res.json({ data: updated });
}));

router.delete('/:id', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const assignment = await prisma.pdfAssignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'not found' });

  const userId = getUserId(req);
  const isOwner = !req.user || assignment.userId === userId;
  if (!isOwner && !canAccess(req, assignment)) {
    return res.status(403).json({ error: 'no permission to delete this assignment' });
  }
  if (assignment.status === 'submitted' || assignment.status === 'graded') {
    return res.status(403).json({ error: 'cannot delete submitted or graded assignment' });
  }

  await prisma.pdfAssignment.delete({ where: { id } }).catch(() => {});
  res.json({ success: true });
}));

// ─────────────────────────────────────────────────────────────
// 笔迹
// ─────────────────────────────────────────────────────────────

router.get('/:id/strokes', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const assignment = await prisma.pdfAssignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (!canAccess(req, assignment)) return res.status(403).json({ error: 'no permission to view strokes' });

  const pageNumber = parseIntParam(req.query.pageNumber, NaN);
  const where: any = { assignmentId: id };
  if (Number.isFinite(pageNumber)) where.pageNumber = pageNumber;

  const strokes = await prisma.pdfAssignmentStroke.findMany({ where, orderBy: { createdAt: 'asc' } });
  res.json({ strokes });
}));

/** 整页笔迹替换式保存（按 pageNumber + layer） */
router.post('/:id/strokes', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const pageNumber = parseIntParam(req.body?.pageNumber, NaN);
  const layer = typeof req.body?.layer === 'string' ? req.body.layer : 'student';
  const strokes = Array.isArray(req.body?.strokes) ? req.body.strokes : [];

  if (!Number.isFinite(pageNumber)) return res.status(400).json({ error: 'pageNumber required' });

  const assignment = await prisma.pdfAssignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (!canAccess(req, assignment)) return res.status(403).json({ error: 'no permission to modify this assignment' });
  if (assignment.status === 'graded') return res.status(403).json({ error: 'assignment is graded, read-only' });

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
    prisma.pdfAssignmentStroke.deleteMany({ where: { assignmentId: id, pageNumber, layer } }),
    ...(strokes.length > 0
      ? [prisma.pdfAssignmentStroke.createMany({
          data: strokes.map((s: any) => ({
            assignmentId: id,
            pageNumber,
            layer,
            tool: s.tool || 'pen',
            color: s.color || '#000000',
            width: s.width || 2,
            points: s.points || [],
          })),
        })]
      : []),
  ]);

  res.json({ success: true, count: strokes.length });
}));

router.delete('/:id/strokes/:strokeId', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const strokeId = parseIntParam(req.params.strokeId, NaN);

  const assignment = await prisma.pdfAssignment.findUnique({ where: { id } });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (!canAccess(req, assignment)) return res.status(403).json({ error: 'no permission to modify this assignment' });

  const stroke = await prisma.pdfAssignmentStroke.findFirst({ where: { id: strokeId, assignmentId: id } });
  if (!stroke) return res.status(404).json({ error: 'stroke not found' });

  if (req.user && !req.user.isAdmin) {
    const isTeacher = req.user.roles.includes('teacher');
    if (isTeacher && stroke.layer !== 'teacher') {
      return res.status(403).json({ error: 'teachers can only delete teacher layer strokes' });
    }
    if (!isTeacher && stroke.layer !== 'student') {
      return res.status(403).json({ error: 'students can only delete student layer strokes' });
    }
  }

  await prisma.pdfAssignmentStroke.delete({ where: { id: strokeId } });
  res.json({ success: true });
}));

/**
 * 导出所需信息。
 * 笔迹本身也一并返回 —— 阅读器里已经在同一个 canvas 上叠加绘制，
 * 前端不需要再来取一次。
 */
router.post('/:id/export', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = parseIntParam(req.params.id, NaN);
  const pageNumber = parseIntParam(req.body?.pageNumber, NaN);
  if (!Number.isFinite(pageNumber)) return res.status(400).json({ error: 'pageNumber required' });

  const assignment = await prisma.pdfAssignment.findUnique({
    where: { id },
    include: { book: { select: { id: true, title: true, pageSizes: true } } },
  });
  if (!assignment) return res.status(404).json({ error: 'assignment not found' });
  if (!canAccess(req, assignment)) return res.status(403).json({ error: 'no permission to view this assignment' });

  const strokes = await prisma.pdfAssignmentStroke.findMany({
    where: { assignmentId: id, pageNumber },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    data: {
      fileUrl: `/api/pdf/books/${assignment.bookId}/file`,
      bookId: assignment.bookId,
      bookTitle: (assignment as any).book?.title ?? '',
      pageNumber,
      strokes,
      assignment: { id: assignment.id, title: assignment.title, status: assignment.status },
    },
  });
}));

export default router;
