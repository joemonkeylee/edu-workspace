import prisma from '../prisma.js';

/**
 * 全局书籍索引 + 教材/答案配对关系的辅助函数。
 *
 * 背景：书籍列表接口以前每次请求都要做三次全表扫描（匹配集带 attributes、配对反查索引、
 * id→title 映射），在 1.4 万本书的库上单次要 1~3 秒。而这三样东西只随「导入/编辑/配对」变化，
 * 与用户当前筛选无关，因此这里统一缓存成一份索引：
 *   - answerSideIds：答案页书籍（不进列表）
 *   - tbToAnswers  ：教材 id → 它的答案书列表（反向配对索引）
 *   - idToTitle    ：书名映射
 *   - partnerAnchorIds：有答案配对的教材（「只看答案配对」筛选用）
 *   - kindCounts   ：全库 book/course 计数（Tab 角标）
 *
 * 靠 TTL + stale-while-revalidate 保鲜：过期后先用旧索引立即响应，后台重建，请求不再被阻塞。
 */

export interface PairEntry { with: number; role: 'textbook' | 'answer'; boundAt?: string }
export interface AnswerLite { id: number; title: string }

export function getPairs(attrs: any): PairEntry[] {
  if (!attrs) return [];
  if (Array.isArray(attrs.pairs)) return attrs.pairs;
  if (attrs.pair && typeof attrs.pair === 'object') return [attrs.pair];
  return [];
}

/** True if this book declares itself as a textbook anchor (self-pair with role='textbook'). */
export function isTextbookAnchor(attrs: any, bookId: number): boolean {
  return getPairs(attrs).some((p) => p.role === 'textbook' && p.with === bookId);
}

/** True if this book only has outward 'answer' pair entries (it is an answer-side companion). */
export function isAnswerSide(attrs: any, bookId: number): boolean {
  const pairs = getPairs(attrs);
  if (pairs.length === 0) return false;
  return !pairs.some((p) => p.role === 'textbook' && p.with === bookId)
    && pairs.some((p) => p.role === 'answer');
}

export interface PairSummary {
  role: 'textbook' | 'answer' | null;
  partnerCount: number;
  partners: Array<{ id: number; title: string }>;
}

export function buildPairSummary(attrs: any, bookId: number, index: BookIndex): PairSummary {
  const pairs = getPairs(attrs);
  if (pairs.length === 0) return { role: null, partnerCount: 0, partners: [] };

  if (isTextbookAnchor(attrs, bookId)) {
    const partners = index.tbToAnswers.get(bookId) ?? [];
    return { role: 'textbook', partnerCount: partners.length, partners };
  }

  if (isAnswerSide(attrs, bookId)) {
    const partners: Array<{ id: number; title: string }> = [];
    const seen = new Set<number>();
    for (const p of pairs) {
      if (p.role !== 'answer' || p.with === bookId || seen.has(p.with)) continue;
      seen.add(p.with);
      partners.push({ id: p.with, title: index.idToTitle.get(p.with) ?? `Book #${p.with}` });
    }
    return { role: 'answer', partnerCount: partners.length, partners };
  }

  return { role: null, partnerCount: 0, partners: [] };
}

export interface BookIndex {
  builtAt: number;
  /** 答案页书籍 id（列表里不展示这些） */
  answerSideIds: number[];
  answerSideSet: Set<number>;
  /** 有答案配对的教材 id */
  partnerAnchorIds: number[];
  partnerAnchorSet: Set<number>;
  tbToAnswers: Map<number, AnswerLite[]>;
  idToTitle: Map<number, string>;
  kindCounts: { book: number; course: number };
  totalBooks: number;
}

async function buildBookIndex(): Promise<BookIndex> {
  const rows = await prisma.book.findMany({
    where: { isDeleted: false },
    select: { id: true, title: true, kind: true, attributes: true },
  });

  const idToTitle = new Map<number, string>();
  const tbToAnswers = new Map<number, AnswerLite[]>();
  const answerSideIds: number[] = [];
  const selfAnchorIds = new Set<number>();
  const kindCounts = { book: 0, course: 0 };

  for (const b of rows) {
    idToTitle.set(b.id, b.title);
    if (b.kind === 'course') kindCounts.course += 1;
    else kindCounts.book += 1;

    const pairs = getPairs(b.attributes);
    if (pairs.length === 0) continue;

    if (isTextbookAnchor(b.attributes, b.id)) selfAnchorIds.add(b.id);
    else if (isAnswerSide(b.attributes, b.id)) answerSideIds.push(b.id);

    // 反向索引：答案书 → 它指向的教材
    for (const p of pairs) {
      if (p.role !== 'answer' || p.with === b.id) continue;
      const arr = tbToAnswers.get(p.with) ?? [];
      arr.push({ id: b.id, title: b.title });
      tbToAnswers.set(p.with, arr);
    }
  }

  const partnerAnchorIds = [...selfAnchorIds].filter((id) => (tbToAnswers.get(id)?.length ?? 0) > 0);

  return {
    builtAt: Date.now(),
    answerSideIds,
    answerSideSet: new Set(answerSideIds),
    partnerAnchorIds,
    partnerAnchorSet: new Set(partnerAnchorIds),
    tbToAnswers,
    idToTitle,
    kindCounts,
    totalBooks: rows.length,
  };
}

/** 索引保鲜时长；过期后用旧索引先响应，同时后台重建 */
const TTL_MS = 30_000;

let cache: BookIndex | null = null;
let inflight: Promise<BookIndex> | null = null;
/** 失效计数器：构建期间若发生失效，这次构建结果会被丢弃，避免写回过期数据 */
let revision = 0;
let refreshTimer: NodeJS.Timeout | null = null;

function refresh(): Promise<BookIndex> {
  if (!inflight) {
    const startedAt = revision;
    inflight = buildBookIndex().then(
      (idx) => {
        inflight = null;
        if (startedAt === revision) cache = idx;
        return idx;
      },
      (err) => {
        inflight = null;
        throw err;
      },
    );
  }
  return inflight;
}

/** 失效后延迟重建（防抖），这样紧接着的用户请求能直接命中新索引 */
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const run = (): void => {
      if (inflight) {
        // 等上一次构建结束后再重建，确保拿到失效之后的数据
        void inflight.then(run, run);
        return;
      }
      void refresh().catch(() => { /* 重建失败时下次请求会再试 */ });
    };
    run();
  }, 300);
}

export async function getBookIndex(): Promise<BookIndex> {
  if (cache && Date.now() - cache.builtAt < TTL_MS) return cache;
  if (cache) {
    // stale-while-revalidate：先拿旧索引顶上，重建在后台进行
    void refresh().catch(() => { /* 后台重建失败时继续用旧索引 */ });
    return cache;
  }
  return refresh();
}

/** 书籍/配对关系被改动后调用：清掉缓存并在后台重建（不阻塞请求） */
export function invalidateBookIndex(): void {
  revision += 1;
  cache = null;
  scheduleRefresh();
}

/** 服务启动时预热，避免首个请求等待全表扫描 */
export function warmBookIndex(): void {
  void refresh().catch(() => { /* 启动预热失败可忽略，首个请求会再试 */ });
}
