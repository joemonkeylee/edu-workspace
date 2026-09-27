/**
 * 听力单句的复习设置。
 *
 * 和 typing 那边刻意分成两个 store：单词可以按 20% 比例把备用词混进章节里，
 * 听力不行 —— 句子练习的队列是被音频时间轴钉住的顺序，往中间插一句外来的句子
 * 会让「播到哪一句、打到哪一句」对不上。所以这边没有 spotCheckMixRatio / Mode
 * 两个旋钮，复习和抽查都走独立的练习面（见 SentenceReviewPanel）。
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_REVIEW_CONFIG, type ReviewConfig } from '../review/types.ts';

export type ListeningReviewSettings = Omit<ReviewConfig, 'spotCheckMixRatio' | 'spotCheckMixMode'> & {
  /** 一轮复习 / 抽查做几句，默认 12（一句比一个词费时间得多） */
  reviewBatchSize: number;
};

export const DEFAULT_LISTENING_REVIEW_SETTINGS: ListeningReviewSettings = {
  reviewPassCount: DEFAULT_REVIEW_CONFIG.reviewPassCount,
  spotCheckFailLimit: DEFAULT_REVIEW_CONFIG.spotCheckFailLimit,
  graduateAfterCheckPass: DEFAULT_REVIEW_CONFIG.graduateAfterCheckPass,
  masteredWrongReturnsToPool: DEFAULT_REVIEW_CONFIG.masteredWrongReturnsToPool,
  manualKnowTarget: DEFAULT_REVIEW_CONFIG.manualKnowTarget,
  reviewBatchSize: 12,
};

type State = ListeningReviewSettings & {
  update: (patch: Partial<ListeningReviewSettings>) => void;
  reset: () => void;
};

const PERSIST_KEYS = [
  'reviewPassCount',
  'spotCheckFailLimit',
  'graduateAfterCheckPass',
  'masteredWrongReturnsToPool',
  'manualKnowTarget',
  'reviewBatchSize',
] as const satisfies readonly (keyof State)[];

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export const useListeningReviewSettings = create<State>()(
  persist(
    (set) => ({
      ...DEFAULT_LISTENING_REVIEW_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_LISTENING_REVIEW_SETTINGS }),
    }),
    {
      name: 'listening-review-settings',
      // 显式传 storage：persist 默认的 storage 在模块初始化时就取好全局对象，
      // 显式传入可避免环境差异导致的静默失效
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        for (const k of PERSIST_KEYS) out[k] = s[k];
        return out as Partial<State>;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return {
          ...current,
          ...p,
          // 防呆：老数据或手改 localStorage 可能存进非法值
          reviewPassCount: clampInt(p.reviewPassCount, 1, 10, DEFAULT_LISTENING_REVIEW_SETTINGS.reviewPassCount),
          spotCheckFailLimit: clampInt(p.spotCheckFailLimit, 1, 10, DEFAULT_LISTENING_REVIEW_SETTINGS.spotCheckFailLimit),
          graduateAfterCheckPass: clampInt(p.graduateAfterCheckPass, 0, 20, DEFAULT_LISTENING_REVIEW_SETTINGS.graduateAfterCheckPass),
          reviewBatchSize: clampInt(p.reviewBatchSize, 1, 50, DEFAULT_LISTENING_REVIEW_SETTINGS.reviewBatchSize),
          update: current.update,
          reset: current.reset,
        };
      },
    },
  ),
);
