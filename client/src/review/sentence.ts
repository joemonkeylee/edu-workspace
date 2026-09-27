/**
 * 听力单句领域（english 模块）接入泛型复习引擎。
 *
 * 层级映射：
 *   一级 group = constants.ts 里的 series（如「新概念英语 · 英音」，共 28 个）
 *   二级 unit  = 一本书 bookId（共 66 本）
 *   条目 item  = 一句Speech，键 = bookId::lessonId::句序
 *
 * 与 word 领域唯一的结构差异：**单词要跨书去重，句子不要。**
 *   单词那边同一个 abandon 出现在 56 本书里，键只能是「单词本身」，否则同一个词要练 56 遍；
 *   听力这边键带座位号，同一句 'Yes it is.' 在一课里出现三次就是三次听辨，
 *   合并掉的话「这节课有几句会了」这个分母就对不上。
 * 所以这边的一级进度是「各书求和」而不是「并集去重」—— 句子天然不重复。
 */

import { useEffect, useMemo } from 'react';
import { computeProgress, mergeProgress } from './engine.ts';
import { lookupFor, useAsyncData, type Async } from './hooks.ts';
import type { ReviewBuckets } from './repository.ts';
import { sentenceKeys, type LessonSize } from './sentenceKeys.ts';
import { getReviewStore } from './store.ts';
import type { ReviewDomain, ReviewItemState, ReviewProgress } from './types.ts';

export const SENTENCE_DOMAIN: ReviewDomain = 'sentence';

/** 索引产物：scripts/build-listening-index.mjs 生成 */
export const INDEX_BASE = '/listening/_index';

export type UnitMeta = {
  id: string;
  name: string;
  group: string;
  lessons: number;
  sentences: number;
};

export type GroupMeta = {
  group: string;
  file: string;
  units: number;
  lessons: number;
  sentences: number;
};

export type SentenceIndexMeta = {
  version: number;
  generatedAt: string;
  unitCount: number;
  groupCount: number;
  lessonCount: number;
  sentenceCount: number;
  units: UnitMeta[];
  groups: GroupMeta[];
};

/** 同一份数据只 fetch 一次：并发请求共享同一个 promise */
function inflight<T>(cache: Map<string, Promise<T>>, k: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(k);
  if (hit) return hit;
  const p = make().catch((e) => {
    cache.delete(k);
    throw e;
  });
  cache.set(k, p);
  return p;
}

/** 一课的形态：<id>|<句数>|<课名>，解出来就是这个样子 */
export type LessonEntry = LessonSize & { title: string };

const metaCache = new Map<string, Promise<SentenceIndexMeta | null>>();
const groupCache = new Map<string, Promise<Record<string, LessonEntry[]>>>();

const loadMeta = () =>
  inflight(metaCache, 'meta', async () => {
    try {
      const res = await fetch(`${INDEX_BASE}/meta.json`);
      if (!res.ok) return null;
      return (await res.json()) as SentenceIndexMeta;
    } catch {
      return null;
    }
  });

/** 单个系列分片 -> 每本书的「课 id / 句数」列表 */
const loadGroupFile = async (group: string): Promise<Record<string, LessonEntry[]>> => {
  const meta = await loadMeta();
  if (!meta) return {};
  return inflight(groupCache, group, async () => {
    const g = meta.groups.find((x) => x.group === group);
    if (!g) return {};
    try {
      const res = await fetch(`${INDEX_BASE}/${g.file}`);
      if (!res.ok) return {};
      const raw = (await res.json()) as Record<string, string>;
      const out: Record<string, LessonEntry[]> = {};
      for (const [unitId, joined] of Object.entries(raw)) {
        out[unitId] = String(joined ?? '')
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            // 行格式：<lessonId>|<句数>|<课名>
            const [id, count, title] = line.split('|');
            return { id: id ?? '', count: Number(count) || 0, title: title ?? '' };
          });
      }
      return out;
    } catch {
      return {};
    }
  });
};

export async function unitMeta(unitId: string): Promise<UnitMeta | null> {
  const m = await loadMeta();
  return m?.units.find((u) => u.id === unitId) ?? null;
}

/** 某本书的课清单（含占位课，句数 0） */
export async function bookLessons(unitId: string): Promise<LessonEntry[]> {
  const m = await loadMeta();
  const unit = m?.units.find((u) => u.id === unitId);
  if (!unit) return [];
  const bucket = await loadGroupFile(unit.group);
  return bucket[unitId] ?? [];
}

/** 某个系列下所有书的课清单 */
export async function seriesUnits(group: string): Promise<Record<string, LessonEntry[]>> {
  const m = await loadMeta();
  if (!m?.groups.some((g) => g.group === group)) return {};
  return loadGroupFile(group);
}

// ── 进度 ────────────────────────────────────────────────────────

export async function unitProgress(unitId: string, buckets: ReviewBuckets): Promise<ReviewProgress | null> {
  const lessons = await bookLessons(unitId);
  if (lessons.length === 0) return null;
  const lookup = lookupFor(buckets);
  return computeProgress(sentenceKeys(unitId, lessons), lookup);
}

/** 一级系列 = 其下所有书的句子求并（句子本来就不重复，等价于求和） */
export async function groupProgress(group: string, buckets: ReviewBuckets): Promise<ReviewProgress | null> {
  const units = await seriesUnits(group);
  const lookup = lookupFor(buckets);
  const list = Object.entries(units).filter(([, lessons]) => lessons.length > 0);
  if (list.length === 0) return null;
  return computeProgress(
    (function* () {
      for (const [unitId, lessons] of list) {
        yield* sentenceKeys(unitId, lessons);
      }
    })(),
    lookup,
  );
}

// ── hooks ───────────────────────────────────────────────────────

export function useSentenceStore() {
  return getReviewStore(SENTENCE_DOMAIN)();
}

/** 首次挂载时拉本地 + 云端 */
export function useSentenceReviewHydrate() {
  const ready = getReviewStore(SENTENCE_DOMAIN)((s) => s.ready);
  const hydrate = getReviewStore(SENTENCE_DOMAIN)((s) => s.hydrate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) void hydrate();
  }, [ready, hydrate]);
  return ready;
}

export function useSentenceIndexMeta(): Async<SentenceIndexMeta> {
  return useAsyncData(() => loadMeta(), []);
}

/** 单本书的掌握度 */
export function useBookProgress(bookId: string | null): Async<ReviewProgress> {
  const buckets = getReviewStore(SENTENCE_DOMAIN)((s) => s.buckets);
  const revision = getReviewStore(SENTENCE_DOMAIN)((s) => s.revision);
  return useAsyncData(() => (bookId ? unitProgress(bookId, buckets) : Promise.resolve(null)), [bookId, revision]);
}

/** 一级系列的总掌握度 */
export function useSeriesProgress(group: string | null): Async<ReviewProgress> {
  const buckets = getReviewStore(SENTENCE_DOMAIN)((s) => s.buckets);
  const revision = getReviewStore(SENTENCE_DOMAIN)((s) => s.revision);
  return useAsyncData(() => (group ? groupProgress(group, buckets) : Promise.resolve(null)), [group, revision]);
}

/** 某个系列下每本书各自的掌握度，用于书籍列表里的进度条 */
export function useSeriesBookProgress(group: string | null): Async<Map<string, ReviewProgress>> {
  const buckets = getReviewStore(SENTENCE_DOMAIN)((s) => s.buckets);
  const revision = getReviewStore(SENTENCE_DOMAIN)((s) => s.revision);
  return useAsyncData(
    async () => {
      if (!group) return null;
      const units = await seriesUnits(group);
      const lookup = lookupFor(buckets);
      const out = new Map<string, ReviewProgress>();
      for (const [unitId, lessons] of Object.entries(units)) {
        if (lessons.length === 0) continue;
        out.set(unitId, computeProgress(sentenceKeys(unitId, lessons), lookup));
      }
      return out;
    },
    [group, revision],
  );
}

/**
 * 一次性算出全部书的进度（以及各系列的合计）。
 *
 * 书架页面要给每个系列都显示一句掌握度，没法给每张卡片各调一个 hook
 * —— 卡片数量是动态的。这里在父组件算一次，卡片只查表。
 * 代价是迭代全部 14 万个句子键，一次几毫秒，可接受。
 */
export function useAllSentenceProgress(): Async<{
  units: Map<string, ReviewProgress>;
  groups: Map<string, ReviewProgress>;
}> {
  const buckets = getReviewStore(SENTENCE_DOMAIN)((s) => s.buckets);
  const revision = getReviewStore(SENTENCE_DOMAIN)((s) => s.revision);
  return useAsyncData(
    async () => {
      const meta = await loadMeta();
      if (!meta) return null;
      const lookup = lookupFor(buckets);
      const units = new Map<string, ReviewProgress>();
      const groups = new Map<string, ReviewProgress>();
      for (const g of meta.groups) {
        const bookMap = await seriesUnits(g.group);
        const acc: ReviewProgress[] = [];
        for (const [unitId, lessons] of Object.entries(bookMap)) {
          if (lessons.length === 0) continue;
          const p = computeProgress(sentenceKeys(unitId, lessons), lookup);
          units.set(unitId, p);
          acc.push(p);
        }
        if (acc.length > 0) groups.set(g.group, mergeProgress(acc));
      }
      return { units, groups };
    },
    [revision],
  );
}

/** 错题池 / 备用池的条目，按「最该复习」排序 */
export function useSentencePool(status: 'wrong' | 'standby'): ReviewItemState[] {
  const active = getReviewStore(SENTENCE_DOMAIN)((s) => s.buckets.active);
  return useMemo(() => {
    const list = Object.values(active).filter((s) => s.status === status);
    if (status === 'wrong') {
      return list.sort((a, b) => b.wrongTotal - a.wrongTotal || a.lastResultAt - b.lastResultAt);
    }
    return list.sort((a, b) => a.lastCheckAt - b.lastCheckAt || a.lastResultAt - b.lastResultAt);
  }, [active, status]);
}

export function useSentenceCounts() {
  const buckets = getReviewStore(SENTENCE_DOMAIN)((s) => s.buckets);
  return useMemo(() => {
    let wrong = 0;
    let standby = 0;
    for (const s of Object.values(buckets.active)) {
      if (s.status === 'wrong') wrong += 1;
      else if (s.status === 'standby') standby += 1;
    }
    return { wrong, standby, mastered: buckets.mastered.size, touched: buckets.ungraded.size };
  }, [buckets]);
}
