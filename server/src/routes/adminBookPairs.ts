import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';
import { teacherOrAdminRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(teacherOrAdminRequired);

// ── Role keywords for identifying textbook vs answer ───────────────

const TEXTBOOK_KEYWORDS = ['原卷版', '原题版', '学生版', '试题版', '空白', '空白版'];
const ANSWER_KEYWORDS = ['解析版', '答案版', '答案', '参考答案', '解析', '全解全析', '详解'];
const ALL_VERSION_KEYWORDS = [...TEXTBOOK_KEYWORDS, ...ANSWER_KEYWORDS];

// Wrap in brackets variants
const BRACKET_PATTERNS = [
  /\(([^)]*)\)/g,   // ASCII ( )
  /（([^）]*)）/g,  // CJK （ ）
  /\[([^\]]*)\]/g,  // [ ]
  /【([^】]*)】/g,  // 【 】
];

/**
 * Extract the "base title" by removing bracket segments that contain version keywords.
 * Example: "鲁教版6.5 一次函数的应用（解析版）" → "鲁教版6.5 一次函数的应用"
 */
function extractBaseTitle(title: string): string {
  let result = title;
  for (const re of BRACKET_PATTERNS) {
    result = result.replace(re, (match, inner) => {
      return ALL_VERSION_KEYWORDS.some((kw) => inner.includes(kw)) ? '' : match;
    });
  }
  return result.trim();
}

/**
 * Detect book role: 'textbook' | 'answer' | null
 */
function detectRole(title: string): 'textbook' | 'answer' | null {
  for (const kw of ANSWER_KEYWORDS) {
    if (title.includes(kw)) return 'answer';
  }
  for (const kw of TEXTBOOK_KEYWORDS) {
    if (title.includes(kw)) return 'textbook';
  }
  return null;
}

function detectKeyword(title: string): string | null {
  for (const kw of ALL_VERSION_KEYWORDS) {
    if (title.includes(kw)) return kw;
  }
  return null;
}

interface BookLite {
  id: number;
  title: string;
  category: string;
  totalPages: number;
  role: 'textbook' | 'answer' | null;
  baseTitle: string;
  keyword: string | null;
}

// ── Rules: return current matching rules (so frontend can display) ──

router.get('/rules', asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    data: {
      textbookKeywords: TEXTBOOK_KEYWORDS,
      answerKeywords: ANSWER_KEYWORDS,
      bracketPatterns: [
        { pattern: '(...)', desc: 'ASCII 半角括号' },
        { pattern: '（...）', desc: 'CJK 全角括号' },
        { pattern: '[...]', desc: 'ASCII 方括号' },
        { pattern: '【...】', desc: 'CJK 方括号' },
      ],
      rule: '去掉括号内含版本关键词的部分，剩余文本作为"基础标题"；基础标题完全相等 + 同分类的教材与答案候选配对',
      example: '"鲁教版6.5 一次函数的应用（解析版）" → 基础标题 "鲁教版6.5 一次函数的应用"',
    },
  });
}));

// ── Scan: returns candidate pairs by base-title matching ───────────

router.get('/scan', asyncHandler(async (req: Request, res: Response) => {
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, totalPages: true, attributes: true },
    orderBy: { title: 'asc' },
  });

  const books: BookLite[] = allBooks.map((b) => {
    const role = detectRole(b.title);
    const baseTitle = extractBaseTitle(b.title);
    const keyword = detectKeyword(b.title);
    return { id: b.id, title: b.title, category: b.category, totalPages: b.totalPages, role, baseTitle, keyword };
  });

  // Group by (category + baseTitle), only groups that have at least one textbook + at least one answer
  const groupMap = new Map<string, BookLite[]>();
  for (const b of books) {
    if (!b.role) continue; // skip books with no version keyword
    const key = `${b.category}||${b.baseTitle}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(b);
  }

  const candidatePairs: Array<{
    key: string;
    baseTitle: string;
    category: string;
    textbooks: BookLite[];
    answers: BookLite[];
    hasDuplicate: boolean; // a group has >2 books → likely duplicate import
    bound: boolean; // already bound (all in pair have attributes.pair)
  }> = [];

  for (const [key, group] of groupMap) {
    const textbooks = group.filter((b) => b.role === 'textbook');
    const answers = group.filter((b) => b.role === 'answer');
    if (textbooks.length === 0 || answers.length === 0) continue;

    // Check if all books in group are already bound
    const allBooksInGroup = allBooks.filter((b) => group.some((g) => g.id === b.id));
    const attrs = allBooksInGroup.map((b) => (b.attributes as any)?.pair);
    const bound = attrs.every((a) => a && a.with);

    candidatePairs.push({
      key,
      baseTitle: group[0].baseTitle,
      category: group[0].category,
      textbooks,
      answers,
      hasDuplicate: group.length > 2,
      bound,
    });
  }

  // Statistics
  const totalBooks = allBooks.length;
  const booksWithRole = books.filter((b) => b.role !== null);
  const orphanTextbooks: number[] = [];
  const orphanAnswers: number[] = [];
  {
    // A book with role but no candidate pair found
    const pairedIds = new Set<number>();
    for (const c of candidatePairs) {
      for (const b of [...c.textbooks, ...c.answers]) pairedIds.add(b.id);
    }
    for (const b of booksWithRole) {
      if (!pairedIds.has(b.id)) {
        if (b.role === 'textbook') orphanTextbooks.push(b.id);
        else orphanAnswers.push(b.id);
      }
    }
  }

  // Pagination
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, Math.min(1000, parseInt(req.query.pageSize as string) || 20));
  const onlyUnbound = req.query.unbound === 'true' || req.query.unbound === '1';
  const onlyDuplicates = req.query.duplicates === 'true' || req.query.duplicates === '1';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  let filtered = candidatePairs;
  if (onlyUnbound) filtered = filtered.filter((c) => !c.bound);
  if (onlyDuplicates) filtered = filtered.filter((c) => c.hasDuplicate);
  if (search) filtered = filtered.filter((c) => c.baseTitle.toLowerCase().includes(search) || c.category.toLowerCase().includes(search));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const data = filtered.slice(start, start + pageSize);

  res.json({
    data,
    total,
    page,
    pageSize,
    stats: {
      totalBooks,
      candidatePairs: candidatePairs.length,
      boundPairs: candidatePairs.filter((c) => c.bound).length,
      unboundPairs: candidatePairs.filter((c) => !c.bound).length,
      duplicateGroups: candidatePairs.filter((c) => c.hasDuplicate).length,
      orphanTextbooks: orphanTextbooks.length,
      orphanAnswers: orphanAnswers.length,
      noVersionKeyword: books.filter((b) => b.role === null).length,
    },
  });
}));

// ── List bound pairs ──────────────────────────────────────────────

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, Math.min(1000, parseInt(req.query.pageSize as string) || 20));
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  // Find books that have attributes.pair
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, totalPages: true, attributes: true },
  });

  // Build pair groups: textbook → list of answers
  // pair structure: { with: <id>, role: 'textbook'|'answer', boundAt: string }
  const boundBooks = allBooks.filter((b) => {
    const pair = (b.attributes as any)?.pair;
    return pair && typeof pair.with === 'number' && typeof pair.role === 'string';
  });

  // Group by the textbook ID (anchor)
  const groupByAnchor = new Map<number, { textbook: any; answers: any[] }>();
  for (const b of boundBooks) {
    const pair = (b.attributes as any).pair;
    const anchorId = pair.role === 'textbook' ? b.id : pair.with;
    if (!groupByAnchor.has(anchorId)) {
      groupByAnchor.set(anchorId, { textbook: null, answers: [] });
    }
    const g = groupByAnchor.get(anchorId)!;
    if (pair.role === 'textbook') {
      g.textbook = { id: b.id, title: b.title, category: b.category, totalPages: b.totalPages };
    } else {
      g.answers.push({ id: b.id, title: b.title, category: b.category, totalPages: b.totalPages });
    }
  }

  let groups = Array.from(groupByAnchor.values()).filter((g) => g.textbook);
  if (search) {
    const s = search;
    groups = groups.filter((g) =>
      g.textbook.title.toLowerCase().includes(s) ||
      g.textbook.category.toLowerCase().includes(s) ||
      g.answers.some((a) => a.title.toLowerCase().includes(s))
    );
  }

  const total = groups.length;
  const start = (page - 1) * pageSize;
  const data = groups.slice(start, start + pageSize);

  res.json({ data, total, page, pageSize });
}));

// ── Orphans (books with role keyword but no pair candidate) ─────────

router.get('/orphans', asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.max(1, Math.min(1000, parseInt(req.query.pageSize as string) || 20));
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const roleFilter = req.query.role === 'answer' ? 'answer' : 'textbook';

  // Same logic as scan: find books that have role keyword but no candidate pair
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, totalPages: true, attributes: true },
    orderBy: { title: 'asc' },
  });
  const books = allBooks.map((b) => ({
    id: b.id,
    title: b.title,
    category: b.category,
    totalPages: b.totalPages,
    role: detectRole(b.title),
    baseTitle: extractBaseTitle(b.title),
    attrs: b.attributes,
  }));

  const groupMap = new Map<string, typeof books>();
  for (const b of books) {
    if (!b.role) continue;
    const key = `${b.category}||${b.baseTitle}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(b);
  }
  const pairedIds = new Set<number>();
  for (const [, group] of groupMap) {
    const t = group.filter((b) => b.role === 'textbook');
    const a = group.filter((b) => b.role === 'answer');
    if (t.length > 0 && a.length > 0) {
      for (const b of group) pairedIds.add(b.id);
    }
  }
  let orphans = books.filter((b) => b.role !== null && !pairedIds.has(b.id));
  // Exclude already bound books
  orphans = orphans.filter((b) => {
    const pair = (b.attrs as any)?.pair;
    return !pair || !pair.with;
  });
  if (roleFilter === 'textbook') orphans = orphans.filter((b) => b.role === 'textbook');
  else orphans = orphans.filter((b) => b.role === 'answer');
  if (search) orphans = orphans.filter((b) => b.title.toLowerCase().includes(search) || b.category.toLowerCase().includes(search));

  const total = orphans.length;
  const start = (page - 1) * pageSize;
  const data = orphans.slice(start, start + pageSize).map(({ id, title, category, totalPages, role }) => ({ id, title, category, totalPages, role }));

  res.json({ data, total, page, pageSize });
}));

// ── Bind: create pair relationship ─────────────────────────────────

router.post('/bind', asyncHandler(async (req: Request, res: Response) => {
  const { textbookId, answerIds } = req.body as { textbookId?: number; answerIds?: number[] | number };

  if (!Array.isArray(answerIds)) {
    return res.status(400).json({ error: 'answerIds must be an array' });
  }
  if (!textbookId || !Number.isInteger(textbookId)) {
    return res.status(400).json({ error: 'textbookId required' });
  }
  if (answerIds.length === 0) {
    return res.status(400).json({ error: 'answerIds cannot be empty' });
  }

  const [textbook, answers] = await Promise.all([
    prisma.book.findUnique({ where: { id: textbookId }, select: { id: true, attributes: true } }),
    prisma.book.findMany({ where: { id: { in: answerIds } }, select: { id: true, attributes: true } }),
  ]);
  if (!textbook) return res.status(404).json({ error: 'textbook not found' });
  if (answers.length !== answerIds.length) return res.status(404).json({ error: 'some answers not found' });

  const now = new Date().toISOString();

  // Update textbook
  const textbookAttrs = (textbook.attributes as any) || {};
  textbookAttrs.pair = { with: textbook.id, role: 'textbook', boundAt: now };
  await prisma.book.update({ where: { id: textbook.id }, data: { attributes: textbookAttrs } });

  // Update each answer
  for (const a of answers) {
    const attrs = (a.attributes as any) || {};
    attrs.pair = { with: textbook.id, role: 'answer', boundAt: now };
    await prisma.book.update({ where: { id: a.id }, data: { attributes: attrs } });
  }

  res.json({ success: true, bound: { textbookId: textbook.id, answerIds: answers.map((a) => a.id) } });
}));

// ── Unbind: remove pair relationship ────────────────────────────────

router.post('/unbind', asyncHandler(async (req: Request, res: Response) => {
  const { bookId } = req.body as { bookId?: number };
  if (!bookId || !Number.isInteger(bookId)) {
    return res.status(400).json({ error: 'bookId required' });
  }

  const book = await prisma.book.findUnique({ where: { id: bookId }, select: { id: true, attributes: true } });
  if (!book) return res.status(404).json({ error: 'book not found' });

  const pair = (book.attributes as any)?.pair;
  if (!pair || !pair.with) {
    return res.json({ success: true, message: 'no pair to unbind' });
  }

  // If this book is the textbook (anchor), unbind all its answers too
  // If this book is an answer, just unbind itself
  if (pair.role === 'textbook') {
    // Find all answers bound to this textbook by scanning books with attributes.pair
    // Prisma JSON filtering on MySQL is limited; use string-contains approach
    const allBooksWithPair = await prisma.book.findMany({
      where: { attributes: { string_contains: `"with":${book.id}` } },
      select: { id: true, attributes: true },
    });
    for (const b of allBooksWithPair) {
      const attrs = (b.attributes as any) || {};
      const bPair = attrs.pair;
      if (bPair && bPair.with === book.id) {
        delete attrs.pair;
        await prisma.book.update({ where: { id: b.id }, data: { attributes: attrs } });
      }
    }
  } else {
    // Unbind just this answer
    const attrs = (book.attributes as any) || {};
    if (attrs.pair) delete attrs.pair;
    await prisma.book.update({ where: { id: book.id }, data: { attributes: attrs } });
  }

  res.json({ success: true });
}));

// ── Batch bind ─────────────────────────────────────────────────────

router.post('/bind-batch', asyncHandler(async (req: Request, res: Response) => {
  const { pairs } = req.body as { pairs?: Array<{ textbookId: number; answerIds: number[] }> };
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return res.status(400).json({ error: 'pairs must be a non-empty array' });
  }

  let boundCount = 0;
  for (const p of pairs) {
    if (!p.textbookId || !Array.isArray(p.answerIds) || p.answerIds.length === 0) continue;
    const [textbook, answers] = await Promise.all([
      prisma.book.findUnique({ where: { id: p.textbookId }, select: { id: true, attributes: true } }),
      prisma.book.findMany({ where: { id: { in: p.answerIds } }, select: { id: true, attributes: true } }),
    ]);
    if (!textbook || answers.length === 0) continue;

    const now = new Date().toISOString();
    const textbookAttrs = (textbook.attributes as any) || {};
    textbookAttrs.pair = { with: textbook.id, role: 'textbook', boundAt: now };
    await prisma.book.update({ where: { id: textbook.id }, data: { attributes: textbookAttrs } });
    for (const a of answers) {
      const attrs = (a.attributes as any) || {};
      attrs.pair = { with: textbook.id, role: 'answer', boundAt: now };
      await prisma.book.update({ where: { id: a.id }, data: { attributes: attrs } });
    }
    boundCount++;
  }

  res.json({ success: true, boundCount });
}));

export default router;
