import { Router, Request, Response } from 'express';
import prisma from '../prisma.js';
import { teacherOrAdminRequired } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { runWithConcurrency } from '../utils/concurrency.js';

const router = Router();
router.use(teacherOrAdminRequired);

// ── Role keywords for identifying textbook (MAIN) vs answer (ANSWER) ──

// MAIN = 原卷/练习/题目（供学生作答）
const TEXTBOOK_KEYWORDS = [
  // ── 原有 ──
  '原卷版', '原题版', '学生版', '试题版', '空白', '空白版',
  // ── 新规则补充 ──
  '考试版', '试卷版', '挖空版', '填空版', '默写版', '练习版',
  '汉译英', 'A4', 'A4版',
];

// ANSWER = 答案/解析/教师（含答案/解析/背记）
// 注意：ANSWER 侧先遍历，保证同一书名同时出现两侧关键词时优先判 ANSWER
const ANSWER_KEYWORDS = [
  // ── 原有 ──
  '解析版', '答案版', '答案', '参考答案', '解析', '全解全析', '详解', '教师版', '教师用书',
  // ── 新规则补充 ──
  '背记版', '英译汉', '答案解析',
];
const ALL_VERSION_KEYWORDS = [...TEXTBOOK_KEYWORDS, ...ANSWER_KEYWORDS];

// Wrap in brackets variants
const BRACKET_PATTERNS = [
  /\(([^)]*)\)/g,   // ASCII ( )
  /（([^）]*)）/g,  // CJK （ ）
  /\[([^\]]*)\]/g,  // [ ]
  /【([^】]*)】/g,  // 【 】
];

/**
 * Extract the "base title" by removing bracket segments that contain version keywords,
 * and then stripping any version keyword that appears as a suffix (no brackets).
 * - Bracket case: "鲁教版6.5 一次函数的应用（解析版）" → "鲁教版6.5 一次函数的应用"
 * - Suffix case:  "七下语法精品讲义学生版" → "七下语法精品讲义"
 *                "七下语法精品讲义教师版" → "七下语法精品讲义"
 * Keywords are removed longest-first to avoid "答案" matching inside "答案版".
 */
const SORTED_VERSION_KEYWORDS = [...ALL_VERSION_KEYWORDS].sort((a, b) => b.length - a.length);

function extractBaseTitle(title: string): string {
  let result = title;
  // 1) Remove bracket segments whose inner text contains a version keyword.
  for (const re of BRACKET_PATTERNS) {
    result = result.replace(re, (match, inner) => {
      return ALL_VERSION_KEYWORDS.some((kw) => inner.includes(kw)) ? '' : match;
    });
  }
  // 2) Remove any version keyword that appears as a substring (handles suffix without brackets).
  for (const kw of SORTED_VERSION_KEYWORDS) {
    result = result.split(kw).join('');
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
  grade: string;
  subject: string;
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
      rule: '先去掉括号内含版本关键词的部分，再去掉作为后缀（无括号）的版本关键词，剩余文本作为"基础标题"；基础标题完全相等 + 同分类的教材与答案候选配对',
      examples: [
        '"鲁教版6.5 一次函数的应用（解析版）" → 基础标题 "鲁教版6.5 一次函数的应用"',
        '"七下语法精品讲义学生版" / "七下语法精品讲义教师版" → 基础标题 "七下语法精品讲义"',
      ],
    },
  });
}));

// ── Scan: returns candidate pairs by base-title matching ───────────

router.get('/scan', asyncHandler(async (req: Request, res: Response) => {
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, grade: true, subject: true, totalPages: true, attributes: true },
    orderBy: { title: 'asc' },
  });
  const allBooksById = new Map(allBooks.map((book) => [book.id, book]));

  const books: BookLite[] = allBooks.map((b) => {
    const role = detectRole(b.title);
    const baseTitle = extractBaseTitle(b.title);
    const keyword = detectKeyword(b.title);
    return { id: b.id, title: b.title, category: b.category, grade: b.grade, subject: b.subject, totalPages: b.totalPages, role, baseTitle, keyword };
  });

  // Group by the full book identity. This prevents same-title books from different
  // grades or subjects from becoming pairing candidates.
  const groupMap = new Map<string, BookLite[]>();
  for (const b of books) {
    if (!b.role) continue; // skip books with no version keyword
    const key = `${b.category}||${b.grade}||${b.subject}||${b.baseTitle}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(b);
  }

  const candidatePairs: Array<{
    key: string;
    baseTitle: string;
    category: string;
    textbooks: BookLite[];
    answers: BookLite[];
    hasDuplicate: boolean; // multiple textbooks or answers → ambiguous pairing
    bound: boolean; // already bound (all in pair have attributes.pair)
  }> = [];

  for (const [key, group] of groupMap) {
    const textbooks = group.filter((b) => b.role === 'textbook');
    const answers = group.filter((b) => b.role === 'answer');
    if (textbooks.length === 0 || answers.length === 0) continue;

    // Keep every textbook-answer candidate as a separate row. Ambiguous duplicate
    // groups remain candidates for manual selection and are never auto-bound here.
    for (const textbook of textbooks) {
      for (const answer of answers) {
        const textbookPair = (allBooksById.get(textbook.id)?.attributes as any)?.pair;
        const answerPair = (allBooksById.get(answer.id)?.attributes as any)?.pair;
        candidatePairs.push({
          key: `${key}||${textbook.id}||${answer.id}`,
          baseTitle: group[0].baseTitle,
          category: group[0].category,
          textbooks: [textbook],
          answers: [answer],
          hasDuplicate: textbooks.length > 1 || answers.length > 1,
          bound: textbookPair?.role === 'textbook'
            && answerPair?.role === 'answer'
            && answerPair.with === textbook.id,
        });
      }
    }
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
  const excludeDuplicates = req.query.excludeDuplicates === 'true' || req.query.excludeDuplicates === '1';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  let filtered = candidatePairs;
  if (onlyUnbound) filtered = filtered.filter((c) => !c.bound);
  if (onlyDuplicates) filtered = filtered.filter((c) => c.hasDuplicate);
  if (excludeDuplicates) filtered = filtered.filter((c) => !c.hasDuplicate);
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

// ── Export: dump candidate pairs as TXT (id, title, category) ──────

router.get('/export', asyncHandler(async (req: Request, res: Response) => {
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, grade: true, subject: true, totalPages: true, attributes: true },
    orderBy: { title: 'asc' },
  });
  const allBooksById = new Map(allBooks.map((book) => [book.id, book]));

  const books: BookLite[] = allBooks.map((b) => {
    const role = detectRole(b.title);
    const baseTitle = extractBaseTitle(b.title);
    const keyword = detectKeyword(b.title);
    return { id: b.id, title: b.title, category: b.category, grade: b.grade, subject: b.subject, totalPages: b.totalPages, role, baseTitle, keyword };
  });

  const groupMap = new Map<string, BookLite[]>();
  for (const b of books) {
    if (!b.role) continue;
    const key = `${b.category}||${b.grade}||${b.subject}||${b.baseTitle}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(b);
  }

  const onlyUnbound = req.query.unbound === 'true' || req.query.unbound === '1';
  const onlyDuplicates = req.query.duplicates === 'true' || req.query.duplicates === '1';
  const excludeDuplicates = req.query.excludeDuplicates === 'true' || req.query.excludeDuplicates === '1';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  const candidatePairs: any[] = [];
  for (const [key, group] of groupMap) {
    const textbooks = group.filter((b) => b.role === 'textbook');
    const answers = group.filter((b) => b.role === 'answer');
    if (textbooks.length === 0 || answers.length === 0) continue;

    for (const textbook of textbooks) {
      for (const answer of answers) {
        const textbookPair = (allBooksById.get(textbook.id)?.attributes as any)?.pair;
        const answerPair = (allBooksById.get(answer.id)?.attributes as any)?.pair;
        const bound = textbookPair?.role === 'textbook'
          && answerPair?.role === 'answer'
          && answerPair.with === textbook.id;
        candidatePairs.push({
          baseTitle: group[0].baseTitle,
          category: group[0].category,
          textbooks: [textbook],
          answers: [answer],
          hasDuplicate: textbooks.length > 1 || answers.length > 1,
          bound,
        });
      }
    }
  }

  let filtered = candidatePairs;
  if (onlyUnbound) filtered = filtered.filter((c) => !c.bound);
  if (onlyDuplicates) filtered = filtered.filter((c) => c.hasDuplicate);
  if (excludeDuplicates) filtered = filtered.filter((c) => !c.hasDuplicate);
  if (search) filtered = filtered.filter((c) => c.baseTitle.toLowerCase().includes(search) || c.category.toLowerCase().includes(search));

  // Build TXT
  const lines: string[] = [];
  lines.push(`# 教材答案配对导出 生成时间: ${new Date().toISOString()}`);
  lines.push(`# 筛选: ${onlyUnbound ? '仅未绑定 ' : ''}${onlyDuplicates ? '仅重复组 ' : ''}${search ? `搜索="${search}"` : ''}`);
  lines.push(`# 共 ${filtered.length} 组配对候选`);
  lines.push('');

  for (const c of filtered) {
    lines.push(`=== ${c.category} | ${c.baseTitle} | ${c.bound ? '已绑定' : '待绑定'}${c.hasDuplicate ? ' | 多选项' : ''} ===`);
    for (const t of c.textbooks) {
      lines.push(`  [教材] #${t.id} | ${t.title} | ${t.category}`);
    }
    for (const a of c.answers) {
      lines.push(`  [答案] #${a.id} | ${a.title} | ${a.category}`);
    }
    lines.push('');
  }

  const orphanTextbooks: BookLite[] = [];
  const orphanAnswers: BookLite[] = [];
  const pairedIds = new Set<number>();
  for (const c of candidatePairs) {
    for (const b of [...c.textbooks, ...c.answers]) pairedIds.add(b.id);
  }
  for (const b of books) {
    if (!pairedIds.has(b.id)) {
      if (b.role === 'textbook') orphanTextbooks.push(b);
      else if (b.role === 'answer') orphanAnswers.push(b);
    }
  }
  const noKeyword = books.filter((b) => b.role === null);

  lines.push('');
  lines.push('========== 孤儿教材 ==========');
  for (const b of orphanTextbooks) lines.push(`#${b.id} | ${b.title} | ${b.category}`);
  lines.push('');
  lines.push('========== 孤儿答案 ==========');
  for (const b of orphanAnswers) lines.push(`#${b.id} | ${b.title} | ${b.category}`);
  lines.push('');
  lines.push('========== 无版本关键词 ==========');
  for (const b of noKeyword) lines.push(`#${b.id} | ${b.title} | ${b.category}`);

  const content = lines.join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="book-pairs-${Date.now()}.txt"`);
  res.send(content);
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
  const pageSize = Math.max(1, Math.min(5000, parseInt(req.query.pageSize as string) || 20));
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const roleFilter = req.query.role === 'answer' ? 'answer'
    : req.query.role === 'none' ? 'none'
    : req.query.role === 'textbook' ? 'textbook'
    : 'all';
  const sortBy = (req.query.sortBy as string) || 'id';
  const sortDir = req.query.sortDir === 'desc' ? -1 : 1;

  // Same logic as scan: find books that have role keyword but no candidate pair
  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, totalPages: true, attributes: true },
    orderBy: { id: 'asc' },
  });

  // Compute orphan set and no-keyword set together
  const allWithRole = allBooks.map((b) => ({
    id: b.id,
    title: b.title,
    category: b.category,
    totalPages: b.totalPages,
    role: detectRole(b.title),
    baseTitle: extractBaseTitle(b.title),
    attrs: b.attributes,
  }));

  const groupMap = new Map<string, typeof allWithRole>();
  for (const b of allWithRole) {
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

  // Build unified list with type label
  interface OrphanRow { id: number; title: string; category: string; totalPages: number; type: string; role: 'textbook' | 'answer' | null }
  let rows: OrphanRow[] = [];

  const pushMatch = (b: typeof allWithRole[0], type: string, role: 'textbook' | 'answer' | null) => {
    if (roleFilter !== 'all' && roleFilter !== (role ?? 'none')) return;
    if (role !== null) {
      if (pairedIds.has(b.id)) return;
      const p = (b.attrs as any)?.pair;
      if (p && p.with) return;
    }
    rows.push({ id: b.id, title: b.title, category: b.category, totalPages: b.totalPages, type, role });
  };

  for (const b of allWithRole) {
    if (b.role === null) pushMatch(b, '无版本关键词', null);
    else if (b.role === 'textbook') pushMatch(b, '孤儿教材', 'textbook');
    else pushMatch(b, '孤儿答案', 'answer');
  }

  if (search) rows = rows.filter((b) => b.title.toLowerCase().includes(search) || b.category.toLowerCase().includes(search));

  // Sort
  const validSorts = new Set(['id', 'title', 'category', 'totalPages', 'type']);
  if (validSorts.has(sortBy)) {
    rows.sort((a: any, b: any) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (typeof va === 'string') return va.localeCompare(vb, 'zh') * sortDir;
      return (va - vb) * sortDir;
    });
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const data = rows.slice(start, start + pageSize);

  res.json({ data, total, page, pageSize });
}));

// ── Orphans Export ─────────────────────────────────────────────────

router.get('/orphans/export', asyncHandler(async (req: Request, res: Response) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
  const roleFilter = req.query.role === 'answer' ? 'answer'
    : req.query.role === 'none' ? 'none'
    : req.query.role === 'all' ? 'all'
    : 'textbook';
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids.trim() : '';
  const selectedIds = idsParam ? new Set(idsParam.split(',').map((s) => parseInt(s)).filter((n) => !isNaN(n))) : null;

  const allBooks = await prisma.book.findMany({
    select: { id: true, title: true, category: true, totalPages: true, attributes: true },
    orderBy: { id: 'asc' },
  });

  const allWithRole = allBooks.map((b) => ({
    id: b.id,
    title: b.title,
    category: b.category,
    totalPages: b.totalPages,
    role: detectRole(b.title),
    baseTitle: extractBaseTitle(b.title),
    attrs: b.attributes,
  }));

  const groupMap = new Map<string, typeof allWithRole>();
  for (const b of allWithRole) {
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

  interface Row { id: number; title: string; category: string; type: string; role: 'textbook' | 'answer' | null }
  let rows: Row[] = [];

  const pushIfMatch = (b: typeof allWithRole[0], type: string, role: 'textbook' | 'answer' | null) => {
    if (role === 'textbook' && roleFilter !== 'textbook' && roleFilter !== 'all') return;
    if (role === 'answer' && roleFilter !== 'answer' && roleFilter !== 'all') return;
    if (role === null && roleFilter !== 'none' && roleFilter !== 'all') return;
    if (role !== null) {
      if (pairedIds.has(b.id)) return;
      const p = (b.attrs as any)?.pair;
      if (p && p.with) return;
    }
    rows.push({ id: b.id, title: b.title, category: b.category, type, role });
  };

  for (const b of allWithRole) {
    if (b.role === null) pushIfMatch(b, '无版本关键词', null);
    else if (b.role === 'textbook') pushIfMatch(b, '孤儿教材', 'textbook');
    else pushIfMatch(b, '孤儿答案', 'answer');
  }

  if (search) rows = rows.filter((b) => b.title.toLowerCase().includes(search) || b.category.toLowerCase().includes(search));
  if (selectedIds) rows = rows.filter((b) => selectedIds.has(b.id));

  rows.sort((a, b) => a.id - b.id);

  const lines = rows.map((r) => `${r.id}  |  ${r.title}`);
  const header = [
    `# 孤儿导出 生成时间: ${new Date().toISOString()}`,
    `# 筛选: role=${roleFilter}${search ? ` 搜索="${search}"` : ''}${selectedIds ? ` 已选 ${selectedIds.size} 条` : ''}`,
    `# 共 ${rows.length} 条`,
    '',
  ];
  const content = [...header, ...lines].join('\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="orphans-${Date.now()}.txt"`);
  res.send(content);
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
    // Find all books whose pair.with equals this textbook's id (both answers and the textbook itself)
    const allBooksWithPair = await prisma.book.findMany({
      where: { attributes: { path: '$.pair.with', equals: book.id } } as any,
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

  const bookIds = new Set<number>();
  for (const p of pairs) {
    if (!p.textbookId || !Array.isArray(p.answerIds) || p.answerIds.length === 0) continue;
    bookIds.add(p.textbookId);
    for (const answerId of p.answerIds) bookIds.add(answerId);
  }

  const books = await prisma.book.findMany({
    where: { id: { in: [...bookIds] } },
    select: { id: true, attributes: true },
  });
  const booksById = new Map(books.map((book) => [book.id, book]));
  const updates = new Map<number, { attributes: Record<string, unknown> }>();
  let boundCount = 0;

  for (const p of pairs) {
    if (!p.textbookId || !Array.isArray(p.answerIds) || p.answerIds.length === 0) continue;
    const textbook = booksById.get(p.textbookId);
    const answers = p.answerIds.map((id) => booksById.get(id)).filter((book) => book !== undefined);
    if (!textbook || answers.length === 0) continue;

    const now = new Date().toISOString();
    const textbookAttrs = { ...((textbook.attributes as Record<string, unknown> | null) || {}) };
    textbookAttrs.pair = { with: textbook.id, role: 'textbook', boundAt: now };
    updates.set(textbook.id, { attributes: textbookAttrs });

    for (const a of answers) {
      const attrs = { ...((a.attributes as Record<string, unknown> | null) || {}) };
      attrs.pair = { with: textbook.id, role: 'answer', boundAt: now };
      updates.set(a.id, { attributes: attrs });
    }
    boundCount++;
  }

  await runWithConcurrency([...updates], 10, ([id, data]) =>
    prisma.book.update({ where: { id }, data: { attributes: data.attributes as any } })
  );

  res.json({ success: true, boundCount });
}));

export default router;
