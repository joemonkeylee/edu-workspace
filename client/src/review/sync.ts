/**
 * 复习引擎的云同步。
 *
 * 单独成文件是为了让 repository.ts 保持纯「本地存储 + 分桶」语义，
 * 不依赖 axios，这样核心逻辑可以直接用 node 跑断言。
 *
 * 沿用项目约定：所有云端调用失败都静默降级，本机 localStorage 才是真身。
 */

import {
  clearReviewItems,
  listReviewItems,
  saveReviewItems,
  type ReviewItemPayload,
} from '@/api/client';
import { emptyItemState } from './engine.ts';
import type { ReviewDomain, ReviewItemState, ReviewStatus } from './types.ts';

const MAX_PER_REQUEST = 500;
const VALID_STATUS: ReviewStatus[] = ['none', 'wrong', 'standby', 'mastered'];

export function toPayload(s: ReviewItemState): ReviewItemPayload {
  return {
    key: s.key,
    status: s.status,
    reviewStreak: s.reviewStreak,
    checkStreak: s.checkStreak,
    checkFailStreak: s.checkFailStreak,
    wrongTotal: s.wrongTotal,
    rightTotal: s.rightTotal,
    firstWrongAt: s.firstWrongAt,
    lastResultAt: s.lastResultAt,
    lastCheckAt: s.lastCheckAt,
    units: s.units,
    mistakes: s.mistakes,
    updatedAt: s.updatedAt,
  };
}

export function fromPayload(p: ReviewItemPayload): ReviewItemState {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const base = emptyItemState(p?.key ?? '');
  return {
    ...base,
    key: String(p?.key ?? ''),
    status: VALID_STATUS.includes(p?.status) ? p.status : 'wrong',
    reviewStreak: num(p?.reviewStreak),
    checkStreak: num(p?.checkStreak),
    checkFailStreak: num(p?.checkFailStreak),
    wrongTotal: num(p?.wrongTotal),
    rightTotal: num(p?.rightTotal),
    firstWrongAt: num(p?.firstWrongAt),
    lastResultAt: num(p?.lastResultAt),
    lastCheckAt: num(p?.lastCheckAt),
    units: Array.isArray(p?.units) ? p.units.filter((u): u is string => typeof u === 'string').slice(0, 32) : [],
    mistakes: p?.mistakes && typeof p.mistakes === 'object' ? p.mistakes : undefined,
    updatedAt: num(p?.updatedAt),
  };
}

/** 云端拉取：失败返回 null */
export async function pullFromCloud(domain: ReviewDomain): Promise<ReviewItemState[] | null> {
  try {
    const rows = await listReviewItems(domain);
    return rows.map(fromPayload);
  } catch {
    return null;
  }
}

export async function pushToCloud(domain: ReviewDomain, states: ReviewItemState[]): Promise<void> {
  if (states.length === 0) return;
  const payload = states.map(toPayload);
  try {
    for (let i = 0; i < payload.length; i += MAX_PER_REQUEST) {
      await saveReviewItems(domain, payload.slice(i, i + MAX_PER_REQUEST));
    }
  } catch {
    /* 离线或单机模式：本地已落盘，下次 hydrate 再带上去 */
  }
}

export async function clearCloud(domain: ReviewDomain): Promise<void> {
  try {
    await clearReviewItems(domain);
  } catch {
    /* ignore */
  }
}
