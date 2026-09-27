/**
 * 每个复习领域一个 store（目前 word，后续 sentence 共用同一套引擎）。
 *
 * 刻意不用 zustand 的 persist 中间件：掌握态在内存里是 Set + 对象的混合结构，
 * 自己控制「什么时候序列化」更容易做「三个桶」的存储优化（见 repository.ts）。
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  clearDomain,
  lookupState,
  persistDomain,
  putStates,
  readDomain,
  emptyBuckets,
  type ReviewBuckets,
} from './repository.ts';
import { clearCloud, pullFromCloud, pushToCloud } from './sync.ts';
import { applyResult, markKnown, mergeStates, normalizeItemKey, reopenWrong } from './engine.ts';
import {
  DEFAULT_REVIEW_CONFIG,
  type ReviewConfig,
  type ReviewDomain,
  type ReviewInput,
  type ReviewItemState,
  type ReviewStatus,
  type ReviewTransition,
} from './types.ts';

export type ReviewBatchResult = {
  applied: ReviewItemState[];
  /** 本次发生了实质迁移的词（出池 / 入池），用于弹提示或触发进度重算 */
  promotedToStandby: string[];
  promotedToMastered: string[];
  demotedToWrong: string[];
};

type ReviewStoreState = {
  ready: boolean;
  buckets: ReviewBuckets;
  /** 每次数据变更 +1，方便组件用 useMemo 依赖它重算进度 */
  revision: number;
  hydrate: () => Promise<void>;
  applyResults: (inputs: ReviewInput[], cfg?: Partial<ReviewConfig>) => ReviewBatchResult;
  markKnownMany: (keys: string[], cfg?: Partial<ReviewConfig>) => void;
  reopenMany: (keys: string[]) => void;
  clearAll: () => Promise<void>;
  lookup: (key: string) => ReviewItemState | undefined;
  listByStatus: (status: ReviewStatus) => ReviewItemState[];
};

const stores = new Map<ReviewDomain, UseBoundStore<StoreApi<ReviewStoreState>>>();

/** 待推送云端的变更，按 domain 去抖，避免每答一个词都打一次接口 */
const debounceTimers = new Map<ReviewDomain, ReturnType<typeof setTimeout>>();

function schedulePush(domain: ReviewDomain, states: ReviewItemState[]) {
  if (states.length === 0) return;
  const prev = debounceTimers.get(domain);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    domain,
    setTimeout(() => {
      debounceTimers.delete(domain);
      void pushToCloud(domain, states);
    }, 1500),
  );
}

function makeStore(domain: ReviewDomain) {
  return create<ReviewStoreState>((set, get) => {
    /** 写内存 + 立即落本地 + 排一张云端推送票 */
    const commit = (next: ReviewBuckets, changed: ReviewItemState[]) => {
      persistDomain(domain, next);
      set((s) => ({ buckets: next, revision: s.revision + 1 }));
      schedulePush(domain, changed);
    };

    return {
      ready: false,
      buckets: emptyBuckets(),
      revision: 0,

      async hydrate() {
        if (get().ready) return;
        const local = readDomain(domain);
        set({ buckets: local, ready: true });

        const remote = await pullFromCloud(domain);
        if (!remote || remote.length === 0) {
          // 本地有数据而云端没有（首次登录新设备），把本地推上去
          if (Object.keys(local.active).length > 0 || local.mastered.size > 0 || local.ungraded.size > 0) {
            void pushToCloud(domain, [...Object.values(local.active)]);
          }
          return;
        }

        const buckets = get().buckets;
        const merged: ReviewItemState[] = [];
        const changed: ReviewItemState[] = [];
        for (const r of remote) {
          const cur = lookupState(buckets, r.key);
          const winner = cur ? mergeStates(cur, r) : r;
          merged.push(winner);
          if (!cur || cur.updatedAt !== winner.updatedAt) changed.push(winner);
        }
        const next = putStates(buckets, merged);
        persistDomain(domain, next);
        set((s) => ({ buckets: next, revision: s.revision + 1 }));
        if (changed.length > 0) void pushToCloud(domain, changed);
      },

      applyResults(inputs, cfgPatch) {
        const cfg: ReviewConfig = { ...DEFAULT_REVIEW_CONFIG, ...(cfgPatch ?? {}) };
        const buckets = get().buckets;
        const changed: ReviewItemState[] = [];
        const result: ReviewBatchResult = {
          applied: [],
          promotedToStandby: [],
          promotedToMastered: [],
          demotedToWrong: [],
        };

        for (const raw of inputs) {
          const key = normalizeItemKey(raw.key);
          if (!key) continue;
          const prev = lookupState(buckets, key);
          const { state, transition } = applyResult(prev, raw, cfg);
          // 同一会话重复命中只更新 units 归属，不需要重算进度
          if (transition === 'dup') {
            changed.push(state);
            continue;
          }
          changed.push(state);
          result.applied.push(state);
          if (transition === 'to-standby') result.promotedToStandby.push(key);
          if (transition === 'to-mastered') result.promotedToMastered.push(key);
          if (transition === 'to-wrong') result.demotedToWrong.push(key);
        }

        commit(putStates(buckets, changed), changed);
        return result;
      },

      markKnownMany(keys, cfgPatch) {
        const cfg: ReviewConfig = { ...DEFAULT_REVIEW_CONFIG, ...(cfgPatch ?? {}) };
        const buckets = get().buckets;
        const changed: ReviewItemState[] = [];
        for (const raw of keys) {
          const key = normalizeItemKey(raw);
          const prev = lookupState(buckets, key);
          if (!prev || prev.status === 'none' || prev.status === 'mastered') continue;
          changed.push(markKnown(prev, cfg));
        }
        commit(putStates(buckets, changed), changed);
      },

      reopenMany(keys) {
        const buckets = get().buckets;
        const changed: ReviewItemState[] = [];
        for (const raw of keys) {
          const key = normalizeItemKey(raw);
          const prev = lookupState(buckets, key);
          if (!prev || prev.status === 'wrong') continue;
          changed.push(reopenWrong(prev));
        }
        commit(putStates(buckets, changed), changed);
      },

      async clearAll() {
        clearDomain(domain);
        void clearCloud(domain);
        set((s) => ({ buckets: emptyBuckets(), revision: s.revision + 1 }));
      },

      lookup: (key) => lookupState(get().buckets, normalizeItemKey(key)),

      listByStatus(status) {
        const b = get().buckets;
        if (status === 'wrong' || status === 'standby') {
          return Object.values(b.active).filter((s) => s.status === status);
        }
        if (status === 'mastered') {
          return [...b.mastered].map((key) => {
            const s = lookupState(b, key)!;
            return s;
          });
        }
        return [...b.ungraded].map((key) => lookupState(b, key)!);
      },
    };
  });
}

/** 同一个 domain 永远返回同一个 store 实例 */
export function getReviewStore(domain: ReviewDomain): UseBoundStore<StoreApi<ReviewStoreState>> {
  const hit = stores.get(domain);
  if (hit) return hit;
  const made = makeStore(domain);
  stores.set(domain, made);
  return made;
}

/** 在组件里订阅某个领域的掌握态 */
export function useReviewStore(domain: ReviewDomain): ReviewStoreState {
  return getReviewStore(domain)();
}

export type { ReviewStoreState, ReviewBuckets };
