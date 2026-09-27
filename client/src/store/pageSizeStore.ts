import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * 列表每页条数的唯一数据源。
 *
 * 首页与 admin 概览共用同一批列表组件，每页条数必须是「改一处、两处同时生效、
 * 刷新后还保持」的状态，所以放进 store 而不是各组件里的常量。
 */

/** 概览页「我的提交」（书籍 / PDF 两栏）可选的每页条数 */
export const SUBMISSION_PAGE_SIZES = [5, 10, 20, 50] as const;
export const DEFAULT_SUBMISSION_PAGE_SIZE = 5;

type PageSizeState = {
  submissionPageSize: number;
  setSubmissionPageSize: (size: number) => void;
};

/** 非法值（老数据、手改 localStorage）一律回落到默认档位 */
function normalizeSubmissionSize(size: unknown): number {
  const n = Number(size);
  if (!Number.isFinite(n)) return DEFAULT_SUBMISSION_PAGE_SIZE;
  return (SUBMISSION_PAGE_SIZES as readonly number[]).includes(n)
    ? n
    : DEFAULT_SUBMISSION_PAGE_SIZE;
}

export const usePageSizeStore = create<PageSizeState>()(
  persist(
    (set) => ({
      submissionPageSize: DEFAULT_SUBMISSION_PAGE_SIZE,
      setSubmissionPageSize: (size) => set({ submissionPageSize: normalizeSubmissionSize(size) }),
    }),
    {
      name: 'edu-page-size',
      // 显式指定 storage：persist 默认在模块初始化时取全局对象，显式传入可避免环境差异
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ submissionPageSize: s.submissionPageSize }),
      merge: (persisted, current) => ({
        ...current,
        submissionPageSize: normalizeSubmissionSize(
          (persisted as Partial<PageSizeState> | undefined)?.submissionPageSize,
        ),
      }),
    },
  ),
);
