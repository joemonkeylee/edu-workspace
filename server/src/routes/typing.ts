import { Router, Response } from 'express';
import prisma from '../prisma.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(authRequired);

/**
 * 字母级错输记录：{ [字母下标]: ['错输的字符', ...] }
 * Prisma 的 Json 字段读写都是 any，这里做一次收敛，避免脏数据写入。
 */
type LetterMistakes = Record<string, string[]>;

function sanitizeMistakes(input: unknown): LetterMistakes {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: LetterMistakes = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const chars = value.filter((v): v is string => typeof v === 'string').slice(0, 20);
    if (chars.length > 0) out[key] = chars;
  }
  return out;
}

function mergeMistakes(prev: unknown, next: unknown): LetterMistakes {
  const base = sanitizeMistakes(prev);
  for (const [key, chars] of Object.entries(sanitizeMistakes(next))) {
    base[key] = Array.from(new Set([...(base[key] ?? []), ...chars])).slice(0, 20);
  }
  return base;
}

function sanitizeTiming(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const nums = input.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).slice(0, 256);
  return nums.length > 0 ? nums : null;
}

// ── 写入：单词记录（批量 upsert）────────────────────────────────
router.post('/word-records', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { dictId, chapter, records } = req.body ?? {};
  if (typeof dictId !== 'string' || !dictId) return res.status(400).json({ error: 'dictId is required' });
  if (!Array.isArray(records) || records.length === 0) return res.json({ success: true });

  // 独立单机模式：云端不可用，前端完全依赖 localStorage
  if (!req.user) return res.json({ success: true });

  const userId = req.user.userId;
  const chapterNo = typeof chapter === 'number' ? chapter : -1;
  const batch = records.slice(0, 200);

  const saved = await Promise.all(
    batch
      .map((raw: any) => {
        const word = typeof raw?.word === 'string' ? raw.word.slice(0, 128) : '';
        if (!word) return null;
        const wrongCount = typeof raw?.wrongCount === 'number' ? Math.max(0, Math.trunc(raw.wrongCount)) : 0;
        const timing = sanitizeTiming(raw?.timing);
        const mistakes = sanitizeMistakes(raw?.mistakes);
        return { word, wrongCount, timing, mistakes };
      })
      .filter((v): v is { word: string; wrongCount: number; timing: number[] | null; mistakes: LetterMistakes } => v !== null)
      .map(async (item) => {
        const existing = await prisma.typingWordRecord.findFirst({ where: { userId, dictId, word: item.word } });
        if (existing) {
          // timing 为空时传 undefined，Prisma 会跳过该字段，保留旧值
          return prisma.typingWordRecord.update({
            where: { id: existing.id },
            data: {
              wrongCount: existing.wrongCount + item.wrongCount,
              timing: item.timing ?? undefined,
              mistakes: mergeMistakes(existing.mistakes, item.mistakes) as any,
              chapter: chapterNo >= 0 ? chapterNo : existing.chapter,
            },
          });
        }
        return prisma.typingWordRecord.create({
          data: {
            userId,
            dictId,
            chapter: chapterNo,
            word: item.word,
            wrongCount: item.wrongCount,
            timing: item.timing ?? undefined,
            mistakes: item.mistakes,
          } as any,
        });
      }),
  );

  res.json({ success: true, data: { count: saved.length } });
}));

// ── 写入：章节记录 ──────────────────────────────────────────────
router.post('/chapter-records', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { dictId, chapter, timeSec, correctCount, wrongCount, wordCount } = req.body ?? {};
  if (typeof dictId !== 'string' || !dictId) return res.status(400).json({ error: 'dictId is required' });
  if (!req.user) return res.json({ success: true });

  const record = await prisma.typingChapterRecord.create({
    data: {
      userId: req.user.userId,
      dictId,
      chapter: typeof chapter === 'number' ? chapter : 0,
      timeSec: typeof timeSec === 'number' ? Math.max(0, Math.trunc(timeSec)) : 0,
      correctCount: typeof correctCount === 'number' ? Math.max(0, Math.trunc(correctCount)) : 0,
      wrongCount: typeof wrongCount === 'number' ? Math.max(0, Math.trunc(wrongCount)) : 0,
      wordCount: typeof wordCount === 'number' ? Math.max(0, Math.trunc(wordCount)) : 0,
    },
  });

  res.json({ data: record });
}));

// ── 读取：错词本 ────────────────────────────────────────────────
router.get('/wrong-words', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const dictId = typeof req.query.dictId === 'string' ? req.query.dictId : undefined;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  if (!req.user) return res.json({ data: [] });

  const rows = await prisma.typingWordRecord.findMany({
    where: { userId: req.user.userId, wrongCount: { gt: 0 }, ...(dictId ? { dictId } : {}) },
    orderBy: [{ wrongCount: 'desc' }, { updatedAt: 'desc' }],
    take: limit,
  });

  res.json({
    data: rows.map((r) => ({
      word: r.word,
      dictId: r.dictId,
      chapter: r.chapter,
      wrongCount: r.wrongCount,
      mistakes: sanitizeMistakes(r.mistakes),
      updatedAt: r.updatedAt,
    })),
  });
}));

// ── 读取：各章节练习情况（用于词库进度展示）────────────────────
router.get('/chapter-records', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const dictId = typeof req.query.dictId === 'string' ? req.query.dictId : undefined;
  if (!dictId) return res.status(400).json({ error: 'dictId is required' });
  if (!req.user) return res.json({ data: [] });

  const grouped = await prisma.typingChapterRecord.groupBy({
    by: ['chapter'],
    where: { userId: req.user.userId, dictId },
    _count: { _all: true },
    _sum: { wordCount: true, timeSec: true },
  });

  res.json({
    data: grouped.map((g) => ({
      chapter: g.chapter,
      sessions: g._count._all,
      wordCount: g._sum.wordCount ?? 0,
      timeSec: g._sum.timeSec ?? 0,
    })),
  });
}));

// ── 读取：最近章节记录（统计页时间序列用）──────────────────────
router.get('/history', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  if (!req.user) return res.json({ data: [] });

  const rows = await prisma.typingChapterRecord.findMany({
    where: { userId: req.user.userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json({
    data: rows.map((r) => ({
      id: r.id,
      dictId: r.dictId,
      chapter: r.chapter,
      timeSec: r.timeSec,
      correctCount: r.correctCount,
      wrongCount: r.wrongCount,
      wordCount: r.wordCount,
      createdAt: r.createdAt,
    })),
  });
}));

// ── 读取：总览统计 ──────────────────────────────────────────────
router.get('/summary', asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!req.user) return res.json({ data: null });
  const userId = req.user.userId;

  const [practicedWords, wrongWords, chapters, timeAgg] = await Promise.all([
    prisma.typingWordRecord.count({ where: { userId } }),
    prisma.typingWordRecord.count({ where: { userId, wrongCount: { gt: 0 } } }),
    prisma.typingChapterRecord.count({ where: { userId } }),
    prisma.typingChapterRecord.aggregate({ where: { userId }, _sum: { timeSec: true, wordCount: true } }),
  ]);

  res.json({
    data: {
      practicedWords,
      wrongWords,
      chapters,
      totalTimeSec: timeAgg._sum.timeSec ?? 0,
      totalWords: timeAgg._sum.wordCount ?? 0,
    },
  });
}));

// ── 清理：清空练习记录 ──────────────────────────────────────────
router.delete('/records', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const dictId = typeof req.query.dictId === 'string' ? req.query.dictId : undefined;
  if (!req.user) return res.json({ success: true });
  const where = { userId: req.user.userId, ...(dictId ? { dictId } : {}) };

  await prisma.$transaction([
    prisma.typingWordRecord.deleteMany({ where }),
    prisma.typingChapterRecord.deleteMany({ where }),
  ]);

  res.json({ success: true });
}));

export default router;
