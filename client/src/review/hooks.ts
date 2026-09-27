/**
 * 复习引擎里「跟着某些参数异步算一遍」的通用小工具。
 *
 * word / sentence 两个领域共用：它们唯一要干的事都是
 * 「拉索引 → 按索引里的条目集合 → 对着当前掌握态算一次进度」。
 */

import { useEffect, useState } from 'react';
import { lookupState, type ReviewBuckets } from './repository.ts';
import type { ReviewItemState } from './types.ts';

export type Async<T> = { data: T | null; loading: boolean };

/**
 * 带取消标记的异步取值。
 * 没有它，快速切分类时旧请求会晚于新请求返回，把新结果覆盖掉。
 */
export function useAsyncData<T>(task: () => Promise<T | null>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    task()
      .then((v) => {
        if (cancelled) return;
        setData(v);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading };
}

/** 把「当前三桶掌握态」包成 computeProgress 需要的查表函数 */
export const lookupFor =
  (buckets: ReviewBuckets) =>
  (key: string): ReviewItemState | undefined =>
    lookupState(buckets, key);
