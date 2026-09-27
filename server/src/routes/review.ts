import { Router, Response } from 'express';
import prisma from '../prisma.js';
import { authRequired, AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(authRequired);

const VALID_DOMAINS = ['word', 'sentence'];
const VALID_STATUS = ['none', 'wrong', 'standby', 'mastered'];

/** BigInt 不能直接 JSON.stringify，统一收敛成 number */
function toNum(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}

function clampInt(v: unknown, min: number, max: number, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function toStrList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string').slice(0, 32).map((x) => x.slice(0, 64));
}

type LetterMistakes = Record<string, string[]>;

function sanitizeMistakes(input: unknown): LetterMistakes | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: LetterMistakes = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const chars = v.filter((x): x is string => typeof x === 'string').slice(0, 20);
    if (chars.length > 0) out[k] = chars;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function serialize(row: any) {
  return {
    key: row.key,
    status: row.status,
    reviewStreak: row.reviewStreak,
    checkStreak: row.checkStreak,
    checkFailStreak: row.checkFailStreak,
    wrongTotal: row.wrongTotal,
    rightTotal: row.rightTotal,
    firstWrongAt: toNum(row.firstWrongAt),
    lastResultAt: toNum(row.lastResultAt),
    lastCheckAt: toNum(row.lastCheckAt),
    units: toStrList(row.units),
    mistakes: row.mistakes ?? undefined,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : toNum(row.updatedAt),
  };
}

// ── 读取：某领域的全部掌握态 ────────────────────────────────────
router.get('/items', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const domain = typeof req.query.domain === 'string' ? req.query.domain : '';
  if (!VALID_DOMAINS.includes(domain)) return res.status(400).json({ error: 'invalid domain' });

  const limit = clampInt(req.query.limit, 1, 20000, 20000);
  const rows = await prisma.reviewItemState.findMany({
    where: { userId: req.user!.userId, domain },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  res.json({ data: rows.map(serialize) });
}));

// ── 写入：批量 upsert（幂等，重复提交不会重复计数）─────────────
router.post('/items', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { domain, items } = req.body ?? {};
  if (typeof domain !== 'string' || !VALID_DOMAINS.includes(domain)) {
    return res.status(400).json({ error: 'invalid domain' });
  }
  if (!Array.isArray(items) || items.length === 0) return res.json({ success: true, data: { count: 0 } });

  const userId = req.user!.userId;
  const batch = items.slice(0, 500);

  const result = await prisma.$transaction(
    batch
      .map((raw: any) => {
        const key = typeof raw?.key === 'string' ? raw.key.trim().toLowerCase().slice(0, 191) : '';
        if (!key) return null;
        const status = VALID_STATUS.includes(raw?.status) ? raw.status : 'none';
        const where = { userId_domain_key: { userId, domain, key } };
        const data = {
          status,
          reviewStreak: clampInt(raw?.reviewStreak, 0, 1e6),
          checkStreak: clampInt(raw?.checkStreak, 0, 1e6),
          checkFailStreak: clampInt(raw?.checkFailStreak, 0, 1e6),
          wrongTotal: clampInt(raw?.wrongTotal, 0, 1e9),
          rightTotal: clampInt(raw?.rightTotal, 0, 1e9),
          firstWrongAt: BigInt(clampInt(raw?.firstWrongAt, 0, Number.MAX_SAFE_INTEGER)),
          lastResultAt: BigInt(clampInt(raw?.lastResultAt, 0, Number.MAX_SAFE_INTEGER)),
          lastCheckAt: BigInt(clampInt(raw?.lastCheckAt, 0, Number.MAX_SAFE_INTEGER)),
          units: toStrList(raw?.units),
          mistakes: sanitizeMistakes(raw?.mistakes) ?? undefined,
        };
        return prisma.reviewItemState.upsert({ where, create: { userId, domain, key, ...data } as any, update: data as any });
      })
      .filter((v) => v !== null) as any[],
  );

  res.json({ success: true, data: { count: result.length } });
}));

// ── 读取：分状态计数（用于跨端校验与统计页）────────────────────
router.get('/summary', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const domain = typeof req.query.domain === 'string' ? req.query.domain : '';
  if (!VALID_DOMAINS.includes(domain)) return res.status(400).json({ error: 'invalid domain' });

  const grouped = await prisma.reviewItemState.groupBy({
    by: ['status'],
    where: { userId: req.user!.userId, domain },
    _count: { _all: true },
  });

  const counts: Record<string, number> = { none: 0, wrong: 0, standby: 0, mastered: 0 };
  for (const g of grouped) counts[g.status] = g._count._all;

  res.json({ data: { domain, ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) } });
}));

/**
 * 存量迁移：把 typing_word_record 里错过的单词灌成错题池。
 * 幂等 —— 已经存在的 key 不会被覆盖，只对尚无 review_item_state 记录的单词补一条 wrong。
 */
router.post('/migrate-word-wrongs', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.userId;

  const rows = await prisma.typingWordRecord.findMany({
    where: { userId, wrongCount: { gt: 0 } },
    orderBy: { wrongCount: 'desc' },
    select: { word: true, dictId: true, wrongCount: true, updatedAt: true },
    take: 20000,
  });

  const existing = await prisma.reviewItemState.findMany({
    where: { userId, domain: 'word' },
    select: { key: true },
    take: 50000,
  });
  const known = new Set(existing.map((e) => e.key));

  const todo = rows.filter((r) => r.word && !known.has(r.word.trim().toLowerCase()));
  if (todo.length === 0) return res.json({ success: true, data: { inserted: 0 } });

  const now = BigInt(Date.now());
  await prisma.reviewItemState.createMany({
    data: todo.slice(0, 5000).map((r) => ({
      userId,
      domain: 'word',
      key: r.word.trim().toLowerCase().slice(0, 191),
      status: 'wrong',
      wrongTotal: r.wrongCount,
      firstWrongAt: BigInt(r.updatedAt instanceof Date ? r.updatedAt.getTime() : now),
      lastResultAt: BigInt(r.updatedAt instanceof Date ? r.updatedAt.getTime() : now),
      units: [r.dictId],
    })) as any,
    skipDuplicates: true,
  });

  res.json({ success: true, data: { inserted: todo.length } });
}));

// ── 清理：清空某领域的掌握态 ────────────────────────────────────
router.delete('/items', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const domain = typeof req.query.domain === 'string' ? req.query.domain : '';
  if (!VALID_DOMAINS.includes(domain)) return res.status(400).json({ error: 'invalid domain' });

  await prisma.reviewItemState.deleteMany({ where: { userId: req.user!.userId, domain } });
  res.json({ success: true });
}));

export default router;
