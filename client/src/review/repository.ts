/**
 * 掌握态的本地持久化。
 *
 * 内存里刻意拆成三个桶，不是为了好看，是为了 localStorage 容量：
 * - active  ：wrong / standby，完整状态对象（数量有限，通常几百到几千）
 * - mastered：只存 key 的集合，毕业的词不需要 streak / mistakes
 * - ungraded：练过但没错过的词，同样只存 key
 * 全书记载 42,353 个拼写，若每个掌握的词都存完整对象会轻易撑爆配额。
 *
 * 本文件不依赖任何网络 / UI，可以直接用 node 跑断言。
 */

import { emptyItemState } from './engine.ts';
import type { ReviewDomain, ReviewItemState, ReviewStatus } from './types.ts';

const STORAGE_KEY = 'review-state-v1';
const STORAGE_VERSION = 2;

export type ReviewBuckets = {
  active: Record<string, ReviewItemState>;
  mastered: Set<string>;
  ungraded: Set<string>;
};

type SerializedDomain = {
  active: Record<string, ReviewItemState>;
  mastered: string[];
  ungraded: string[];
};

type SerializedBlob = {
  version: number;
  domains: Record<string, SerializedDomain>;
};

export function emptyBuckets(): ReviewBuckets {
  return { active: {}, mastered: new Set(), ungraded: new Set() };
}

const VALID_STATUS: ReviewStatus[] = ['none', 'wrong', 'standby', 'mastered'];

function sanitizeState(raw: unknown): ReviewItemState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === 'string' ? r.key : '';
  if (!key) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    ...emptyItemState(key),
    key,
    status: (VALID_STATUS.includes(r.status as ReviewStatus) ? r.status : 'wrong') as ReviewStatus,
    reviewStreak: num(r.reviewStreak),
    checkStreak: num(r.checkStreak),
    checkFailStreak: num(r.checkFailStreak),
    wrongTotal: num(r.wrongTotal),
    rightTotal: num(r.rightTotal),
    firstWrongAt: num(r.firstWrongAt),
    lastResultAt: num(r.lastResultAt),
    lastCheckAt: num(r.lastCheckAt),
    lastSessionId: typeof r.lastSessionId === 'string' ? r.lastSessionId : '',
    units: Array.isArray(r.units) ? r.units.filter((u): u is string => typeof u === 'string').slice(0, 32) : [],
    mistakes: r.mistakes && typeof r.mistakes === 'object' ? (r.mistakes as Record<number, string[]>) : undefined,
    updatedAt: num(r.updatedAt),
  };
}

function readBlob(): SerializedBlob {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: STORAGE_VERSION, domains: {} };
    const parsed = JSON.parse(raw) as SerializedBlob;
    if (!parsed || parsed.version !== STORAGE_VERSION || !parsed.domains) {
      return { version: STORAGE_VERSION, domains: {} };
    }
    return parsed;
  } catch {
    return { version: STORAGE_VERSION, domains: {} };
  }
}

function writeBlob(blob: SerializedBlob) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    /* 配额不足时静默失败，不影响本次练习 */
  }
}

export function readDomain(domain: ReviewDomain): ReviewBuckets {
  const d = readBlob().domains[domain];
  if (!d) return emptyBuckets();

  const active: Record<string, ReviewItemState> = {};
  for (const [key, raw] of Object.entries(d.active ?? {})) {
    const s = sanitizeState(raw);
    if (!s || (s.status !== 'wrong' && s.status !== 'standby')) continue;
    active[key] = s;
  }
  return {
    active,
    mastered: new Set((d.mastered ?? []).filter((k): k is string => typeof k === 'string')),
    ungraded: new Set((d.ungraded ?? []).filter((k): k is string => typeof k === 'string')),
  };
}

export function persistDomain(domain: ReviewDomain, buckets: ReviewBuckets) {
  const blob = readBlob();
  blob.domains[domain] = {
    active: buckets.active,
    mastered: [...buckets.mastered],
    ungraded: [...buckets.ungraded],
  };
  writeBlob(blob);
}

export function clearDomain(domain: ReviewDomain) {
  const blob = readBlob();
  delete blob.domains[domain];
  writeBlob(blob);
}

/** 批量落桶：一次性拷贝，避免逐条 put 反复复制 Set */
export function putStates(buckets: ReviewBuckets, states: ReviewItemState[]): ReviewBuckets {
  if (states.length === 0) return buckets;
  const active = { ...buckets.active };
  const mastered = new Set(buckets.mastered);
  const ungraded = new Set(buckets.ungraded);

  for (const s of states) {
    delete active[s.key];
    mastered.delete(s.key);
    ungraded.delete(s.key);
    if (s.status === 'wrong' || s.status === 'standby') active[s.key] = s;
    else if (s.status === 'mastered') mastered.add(s.key);
    else ungraded.add(s.key);
  }

  return { active, mastered, ungraded };
}

export function lookupState(buckets: ReviewBuckets, key: string): ReviewItemState | undefined {
  const hit = buckets.active[key];
  if (hit) return hit;
  if (buckets.mastered.has(key)) return { ...emptyItemState(key), status: 'mastered' };
  if (buckets.ungraded.has(key)) return { ...emptyItemState(key), status: 'none' };
  return undefined;
}
