/**
 * 泛型复习引擎 —— 纯逻辑层。
 *
 * 不依赖 React / localStorage / 网络，方便直接用 node 跑断言脚本验证。
 * 状态迁移总览：
 *
 *   none ──错──▶ wrong ──连答对 N──▶ standby ──抽查通过 K──▶ mastered
 *                  ▲                    │                        │
 *                  └──── 抽查累计错 M ───┘◀── 主线答错（可配）─────┘
 *   wrong / standby / mastered ──手动「认识了」──▶ standby（或 mastered）
 */

import {
  MAX_SOURCE_UNITS,
  type ReviewConfig,
  type ReviewItemState,
  type ReviewInput,
  type ReviewOutcome,
  type ReviewProgress,
  type ReviewTransition,
} from './types';

/** 条目键归一化：同一拼写无论大小写、首尾空格都指向同一条状态 */
export function normalizeItemKey(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function emptyItemState(key: string): ReviewItemState {
  return {
    key,
    status: 'none',
    reviewStreak: 0,
    checkStreak: 0,
    checkFailStreak: 0,
    wrongTotal: 0,
    rightTotal: 0,
    firstWrongAt: 0,
    lastResultAt: 0,
    lastCheckAt: 0,
    lastSessionId: '',
    units: [],
    updatedAt: 0,
  };
}

/** 把一次付款结果涉及的 mistakes 合并进已有记录，单字母最多留 20 个错输字符 */
export function mergeMistakes(
  prev: Record<number, string[]> | undefined,
  next: Record<number, string[]> | undefined,
): Record<number, string[]> | undefined {
  if (!next || Object.keys(next).length === 0) return prev;
  const out: Record<number, string[]> = { ...(prev ?? {}) };
  for (const [rawIndex, chars] of Object.entries(next)) {
    const i = Number(rawIndex);
    if (!Number.isInteger(i) || i < 0) continue;
    const merged = Array.from(new Set([...(out[i] ?? []), ...chars])).slice(0, 20);
    if (merged.length > 0) out[i] = merged;
  }
  return Object.keys(out).length > 0 ? out : prev;
}

function pushUnit(list: string[], unitId?: string): string[] {
  if (!unitId || list.includes(unitId)) return list;
  const next = [...list, unitId];
  return next.length > MAX_SOURCE_UNITS ? next.slice(next.length - MAX_SOURCE_UNITS) : next;
}

/**
 * 施加一次练习结果，返回新状态与本次发生的迁移。
 *
 * 关键取舍：
 * 1. 同一 sessionId 内同一个 key 只生效第一次 —— loopTimes / shuffle 会让同一个词
 *    在一章里出现多次，否则「连答对 2 次」在同一次会话里就能刷出来。
 * 2. peeked（偷看答案）不参与计数，既不奖励也不惩罚。
 * 3. wrongTotal 只增不清，它代表历史而非当前能力。
 */
export function applyResult(
  prev: ReviewItemState | undefined,
  input: ReviewInput,
  cfg: ReviewConfig,
): ReviewOutcome {
  const key = normalizeItemKey(input.key);
  const now = input.now ?? Date.now();
  const base = prev ?? emptyItemState(key);
  const next: ReviewItemState = { ...base, key };

  next.units = pushUnit(next.units, input.unitId);

  // 同一会话内重复命中：只认第一次
  if (base.lastSessionId === input.sessionId) {
    const touched: ReviewItemState = { ...next, updatedAt: now };
    return { state: touched, transition: 'dup' };
  }
  next.lastSessionId = input.sessionId;

  if (input.peeked) {
    return { state: { ...next, updatedAt: now }, transition: 'peeked' };
  }

  next.lastResultAt = now;
  next.updatedAt = now;
  let transition: ReviewTransition = 'none';

  if (input.ok) {
    next.rightTotal += 1;
    if (next.status === 'wrong') {
      next.reviewStreak += 1;
      if (next.reviewStreak >= cfg.reviewPassCount) {
        next.status = 'standby';
        next.reviewStreak = 0;
        next.checkStreak = 0;
        next.checkFailStreak = 0;
        delete next.mistakes;
        transition = 'to-standby';
      }
    } else if (next.status === 'standby') {
      next.checkStreak += 1;
      next.checkFailStreak = 0;
      next.lastCheckAt = now;
      if (cfg.graduateAfterCheckPass > 0 && next.checkStreak >= cfg.graduateAfterCheckPass) {
        next.status = 'mastered';
        next.checkStreak = 0;
        transition = 'to-mastered';
      }
    }
    // none / mastered 答对不产生迁移
  } else {
    next.wrongTotal += 1;
    if (!next.firstWrongAt) next.firstWrongAt = now;
    next.mistakes = mergeMistakes(next.mistakes, input.mistakes);

    if (next.status === 'none') {
      next.status = 'wrong';
      next.reviewStreak = 0;
      transition = 'to-wrong';
    } else if (next.status === 'wrong') {
      // 还在错题池里又错了：已经攒的 progress 清零，从头再来
      next.reviewStreak = 0;
    } else if (next.status === 'standby') {
      next.checkStreak = 0;
      next.checkFailStreak += 1;
      next.lastCheckAt = now;
      if (next.checkFailStreak >= cfg.spotCheckFailLimit) {
        next.status = 'wrong';
        next.reviewStreak = 0;
        next.checkFailStreak = 0;
        transition = 'to-wrong';
      }
    } else if (next.status === 'mastered' && cfg.masteredWrongReturnsToPool) {
      next.status = 'wrong';
      next.reviewStreak = 0;
      next.checkStreak = 0;
      next.checkFailStreak = 0;
      transition = 'to-wrong';
    }
  }

  return { state: next, transition };
}

/** 手动「认识了」：直接移出错题池。默认进备用，仍会被抽查验证 */
export function markKnown(
  prev: ReviewItemState,
  cfg: ReviewConfig,
  now = Date.now(),
): ReviewItemState {
  const next: ReviewItemState = { ...prev };
  const from = next.status;
  next.status = cfg.manualKnowTarget;
  next.reviewStreak = 0;
  next.checkFailStreak = 0;
  if (from === 'wrong') next.checkStreak = 0;
  if (next.status === 'standby') delete next.mistakes;
  next.updatedAt = now;
  return next;
}

/** 手动放回错题池（错题列表里的人工纠正） */
export function reopenWrong(prev: ReviewItemState, now = Date.now()): ReviewItemState {
  return {
    ...prev,
    status: 'wrong',
    reviewStreak: 0,
    checkStreak: 0,
    checkFailStreak: 0,
    firstWrongAt: prev.firstWrongAt || now,
    lastResultAt: now,
    updatedAt: now,
  };
}

/** 从 active / mastered / ungraded 三个桶恢复出一个可直接使用的状态 */
export function stateFromBucket(key: string, status: ReviewItemState['status']): ReviewItemState {
  const s = emptyItemState(key);
  s.status = status;
  return s;
}

/**
 * 按「去重后的条目集合」统计进度。
 *
 * @param keys    该容器去重后的全部条目键（不是原始条目，见 scripts/build-review-index.mjs）
 * @param lookup  查某个 key 的状态
 */
export function computeProgress(
  keys: Iterable<string>,
  lookup: (key: string) => ReviewItemState | undefined,
): ReviewProgress {
  let total = 0;
  let ungraded = 0;
  let wrong = 0;
  let standby = 0;
  let mastered = 0;

  for (const key of keys) {
    total += 1;
    switch (lookup(key)?.status ?? 'none') {
      case 'wrong':
        wrong += 1;
        break;
      case 'standby':
        standby += 1;
        break;
      case 'mastered':
        mastered += 1;
        break;
      default:
        ungraded += 1;
    }
  }

  const learned = standby + mastered;
  const touched = ungraded + wrong + standby + mastered;
  return {
    total,
    ungraded,
    wrong,
    standby,
    mastered,
    masteredRate: total === 0 ? 0 : learned / total,
    coveredRate: total === 0 ? 0 : touched / total,
  };
}

/** 多个容器进度的加权合并：按各自去重词数加权，避免小词库和大词库等量齐观 */
export function mergeProgress(list: ReviewProgress[]): ReviewProgress {
  const acc = list.reduce(
    (a, p) => ({
      total: a.total + p.total,
      ungraded: a.ungraded + p.ungraded,
      wrong: a.wrong + p.wrong,
      standby: a.standby + p.standby,
      mastered: a.mastered + p.mastered,
    }),
    { total: 0, ungraded: 0, wrong: 0, standby: 0, mastered: 0 },
  );
  return {
    ...acc,
    masteredRate: acc.total === 0 ? 0 : (acc.standby + acc.mastered) / acc.total,
    coveredRate: acc.total === 0 ? 0 : (acc.ungraded + acc.wrong + acc.standby + acc.mastered) / acc.total,
  };
}

/** 跨端合并：last-write-wins，updatedAt 相同时保留本地 */
export function mergeStates(local: ReviewItemState, remote: ReviewItemState): ReviewItemState {
  const li = Number(local.updatedAt) || 0;
  const ri = Number(remote.updatedAt) || 0;
  if (ri <= li) return local;
  // units 归并，避免远端覆盖丢掉本地记录的书
  const units = Array.from(new Set([...local.units, ...remote.units])).slice(-MAX_SOURCE_UNITS);
  return { ...remote, units };
}
