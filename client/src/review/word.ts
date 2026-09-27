/**
 * 单词领域（typing 模块）接入泛型复习引擎。
 *
 * 层级映射：
 *   一级 group = typing/dictionaries.ts 里的 category（如「雅思考试」）
 *   二级 unit  = 单个词库 dictId（如 cet4）
 *   条目 item  = 单词，key 为 normalizeItemKey(word.name)
 *
 * 听力单句领域后续照葫芦画瓢：一级=series、二级=bookId、条目=bookId::lessonId::句序。
 */

import { useEffect, useMemo } from 'react';
import { createCatalog, type CatalogMeta } from './catalog.ts';
import { computeProgress } from './engine.ts';
import { lookupFor, useAsyncData, type Async } from './hooks.ts';
import { getReviewStore } from './store.ts';
import type { ReviewDomain, ReviewItemState, ReviewProgress } from './types.ts';
import type { ReviewBuckets } from './repository.ts';

export const WORD_DOMAIN: ReviewDomain = 'word';

/** 索引产物放在公众目录下：scripts/build-review-index.mjs 生成 */
export const wordCatalog = createCatalog('/dicts/_index');

export function useWordStore() {
  return getReviewStore(WORD_DOMAIN)();
}

/** 首次挂载时拉取一遍本地 + 云端 */
export function useReviewHydrate() {
  const ready = getReviewStore(WORD_DOMAIN)((s) => s.ready);
  const hydrate = getReviewStore(WORD_DOMAIN)((s) => s.hydrate);
  useEffect(() => {
    if (!ready) void hydrate();
  }, [ready, hydrate]);
  return ready;
}

export function unitMeta() {
  return wordCatalog.meta();
}

/** 索引元信息：词数、书内去重后的词数、所属分类 */
export function useWordCatalogMeta(): Async<CatalogMeta> {
  return useAsyncData(() => wordCatalog.meta(), []);
}

export async function unitProgress(unitId: string, buckets: ReviewBuckets): Promise<ReviewProgress | null> {
  const words = await wordCatalog.unitWords(unitId);
  if (words.length === 0) return null;
  return computeProgress(words, lookupFor(buckets));
}

export async function groupProgress(group: string, buckets: ReviewBuckets): Promise<ReviewProgress | null> {
  const union = await wordCatalog.groupUnion(group);
  if (union.size === 0) return null;
  return computeProgress(union, lookupFor(buckets));
}

/** 单个词库的掌握度。progress 为 null 表示索引里没有这本书（例如未生成索引） */
export function useDictProgress(dictId: string): Async<ReviewProgress> {
  const buckets = getReviewStore(WORD_DOMAIN)((s) => s.buckets);
  const revision = getReviewStore(WORD_DOMAIN)((s) => s.revision);
  return useAsyncData(() => unitProgress(dictId, buckets), [dictId, revision]);
}

/** 一级分类的掌握度：分母是该分类所有书的词表并集 */
export function useCategoryProgress(group: string | null): Async<ReviewProgress> {
  const buckets = getReviewStore(WORD_DOMAIN)((s) => s.buckets);
  const revision = getReviewStore(WORD_DOMAIN)((s) => s.revision);
  return useAsyncData(() => (group ? groupProgress(group, buckets) : Promise.resolve(null)), [group, revision]);
}

/**
 * 某个分类下所有书的掌握度。
 * 只在切换到具体分类时才加载它那一份索引（几百 KB），「全部词库」页不下载。
 */
export function useCategoryUnitProgress(group: string | null): Async<Map<string, ReviewProgress>> {
  const buckets = getReviewStore(WORD_DOMAIN)((s) => s.buckets);
  const revision = getReviewStore(WORD_DOMAIN)((s) => s.revision);
  return useAsyncData(async () => {
    if (!group) return null;
    const units = await wordCatalog.groupUnits(group);
    const lookup = lookupFor(buckets);
    const out = new Map<string, ReviewProgress>();
    for (const [unitId, words] of Object.entries(units)) {
      if (words.length === 0) continue;
      out.set(unitId, computeProgress(words, lookup));
    }
    return out;
  }, [group, revision]);
}

/** 错题池 / 备用池的条目，按「最该复习」排序 */
export function useReviewPool(status: 'wrong' | 'standby'): ReviewItemState[] {
  const active = getReviewStore(WORD_DOMAIN)((s) => s.buckets.active);
  return useMemo(() => {
    const list = Object.values(active).filter((s) => s.status === status);
    if (status === 'wrong') {
      // 错得越多、越久没练的排前面
      return list.sort((a, b) => b.wrongTotal - a.wrongTotal || a.lastResultAt - b.lastResultAt);
    }
    return list.sort((a, b) => a.lastCheckAt - b.lastCheckAt || a.lastResultAt - b.lastResultAt);
  }, [active, status]);
}

export function useReviewCounts() {
  const buckets = getReviewStore(WORD_DOMAIN)((s) => s.buckets);
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
