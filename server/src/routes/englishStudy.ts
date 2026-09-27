import { Router, Response } from 'express';
import prisma from '../prisma.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * 英语精听学习记录的云同步。
 *
 * 与 review.ts 同一套约定：authRequired + { data } 信封 + 批量 upsert，
 * 冲突以 updatedAt last-write-wins。payload 是客户端整课/整天的聚合体，
 * 服务端只校验形状不解释内容 —— 解释权在 client/src/english/studyRecord.ts。
 */

const router = Router();
router.use(authRequired);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RECORDS_PER_REQUEST = 200;

function validPayload(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ── 学习记录（每课一条）────────────────────────────────────────

/** 读取该用户全部课程记录（量级：几百行 × 几 KB，可接受） */
router.get('/records', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await prisma.englishStudyRecord.findMany({
    where: { userId: req.user!.userId },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });
  res.json({
    data: rows.map((r) => ({
      bookId: r.bookId,
      lessonId: r.lessonId,
      payload: r.payload,
      updatedAt: r.updatedAt.getTime(),
    })),
  });
}));

router.post('/records', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { records } = req.body ?? {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.json({ success: true, data: { count: 0 } });
  }

  const userId = req.user!.userId;
  const batch = records.slice(0, MAX_RECORDS_PER_REQUEST);

  const ops = [];
  for (const raw of batch) {
    const bookId = typeof raw?.bookId === 'string' ? raw.bookId.slice(0, 64) : '';
    const lessonId = typeof raw?.lessonId === 'string' ? raw.lessonId.slice(0, 64) : '';
    if (!bookId || !lessonId || !validPayload(raw?.payload)) continue;
    const data = { payload: raw.payload as object };
    ops.push(
      prisma.englishStudyRecord.upsert({
        where: { userId_bookId_lessonId: { userId, bookId, lessonId } },
        create: { userId, bookId, lessonId, ...data } as any,
        update: data as any,
      }),
    );
  }

  await prisma.$transaction(ops);
  res.json({ success: true, data: { count: ops.length } });
}));

// ── 按天统计 ────────────────────────────────────────────────────

router.get('/daily', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await prisma.englishDailyStat.findMany({
    where: { userId: req.user!.userId },
    orderBy: { date: 'desc' },
    take: 400,
  });
  res.json({
    data: rows.map((r) => ({ date: r.date, payload: r.payload, updatedAt: r.updatedAt.getTime() })),
  });
}));

router.post('/daily', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { days } = req.body ?? {};
  if (!Array.isArray(days) || days.length === 0) {
    return res.json({ success: true, data: { count: 0 } });
  }

  const userId = req.user!.userId;
  const ops = [];
  for (const raw of days.slice(0, MAX_RECORDS_PER_REQUEST)) {
    const date = typeof raw?.date === 'string' && DATE_RE.test(raw.date) ? raw.date : '';
    if (!date || !validPayload(raw?.payload)) continue;
    const data = { payload: raw.payload as object };
    ops.push(
      prisma.englishDailyStat.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...data } as any,
        update: data as any,
      }),
    );
  }

  await prisma.$transaction(ops);
  res.json({ success: true, data: { count: ops.length } });
}));

export default router;
