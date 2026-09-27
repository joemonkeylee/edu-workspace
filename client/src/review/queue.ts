/**
 * 把备用池的词混进主线练习队列。
 *
 * 混入位置由 config.spotCheckMixMode 决定：
 * - tail       ：统一塞在章节末尾，实现简单
 * - interleave ：隔几个词插一个，间隔记忆效果更好（默认）
 *
 * 同一个词只混入一次，且不会重复出现在同一批里。
 */

export type MixedQueue<T> = {
  queue: T[];
  /** 本次真正混进来的备用词集合，用于事后区分这一题属于抽查还是主线 */
  injectedKeys: Set<string>;
};

export function buildMixedQueue<T>(opts: {
  main: T[];
  standby: T[];
  keyOf: (item: T) => string;
  ratio: number;
  mode: 'tail' | 'interleave';
  /** 备用词最多混多少个，缺省不限（受 ratio 限制） */
  maxInject?: number;
}): MixedQueue<T> {
  const { main, standby, keyOf, mode, maxInject } = opts;
  const injectedKeys = new Set<string>();
  if (main.length === 0) return { queue: [...standby.slice(0, maxInject ?? standby.length)], injectedKeys };

  const ratio = opts.ratio > 0 ? Math.min(1, opts.ratio) : 0;
  if (ratio === 0 || standby.length === 0) return { queue: [...main], injectedKeys };

  const existing = new Set(main.map(keyOf));
  let want = Math.max(1, Math.round(main.length * ratio));
  if (maxInject && maxInject > 0) want = Math.min(want, maxInject);

  const picked: T[] = [];
  for (const item of standby) {
    if (picked.length >= want) break;
    const k = keyOf(item);
    if (existing.has(k)) continue;
    existing.add(k);
    picked.push(item);
    injectedKeys.add(k);
  }
  if (picked.length === 0) return { queue: [...main], injectedKeys };

  if (mode === 'tail') {
    return { queue: [...main, ...picked], injectedKeys };
  }

  // interleave：每 step 个主词后面插一个备用词
  const step = Math.max(1, Math.ceil(main.length / picked.length));
  const queue: T[] = [];
  let si = 0;
  for (let i = 0; i < main.length; i += 1) {
    queue.push(main[i]);
    if ((i + 1) % step === 0 && si < picked.length) {
      queue.push(picked[si]);
      si += 1;
    }
  }
  // 主词组数不够导致没插完的，补在末尾
  while (si < picked.length) {
    queue.push(picked[si]);
    si += 1;
  }

  return { queue, injectedKeys };
}

/**
 * 从备用池挑选抽查对象：最久没被抽查过的优先，其次随机。
 * 「最久没抽查」优先保证备用池能被均匀过一遍，而不是总抽到同几个词。
 */
export function pickSpotCheck<T>(
  pool: T[],
  opts: { count: number; lastCheckAtOf?: (item: T) => number; random?: () => number },
): T[] {
  if (pool.length === 0 || opts.count <= 0) return [];
  const rand = opts.random ?? Math.random;
  const scored = pool.map((item) => ({
    item,
    // 从没抽查过的排最前
    last: opts.lastCheckAtOf?.(item) ?? 0,
    rnd: rand(),
  }));
  scored.sort((a, b) => a.last - b.last || a.rnd - b.rnd);
  return scored.slice(0, opts.count).map((s) => s.item);
}
