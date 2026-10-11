/**
 * 日语学习 Zustand store + localStorage 持久化
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SRSState, LessonProgress, StudyProgress, ReviewGrade } from '@/japanese/types/models';
import { createInitialSRSState, calculateNextReview, isDue } from '@/japanese/engine/srs';
import type { Lesson } from '@/japanese/types/lesson';
import { loadAllLessons, makeCardKey } from '@/japanese/utils/packLoader';

const PACK_ID = 'japanese';

interface JpState {
  lessons: Lesson[];
  srs: Record<string, SRSState>;
  lessonProgress: Record<string, LessonProgress>;
  study: StudyProgress;
  /** UI 显示语言：默认英文，可切回西语看原始数据 */
  lang: 'en' | 'es';

  // actions
  init: () => void;
  recordReview: (cardKey: string, grade: ReviewGrade) => SRSState;
  getDueCards: (limit?: number) => SRSState[];
  completeLesson: (lessonId: string) => void;
  getLessonStatus: (lessonId: string) => LessonProgress['status'];
  resetAll: () => void;
  setLang: (lang: 'en' | 'es') => void;
  _computeStatuses: () => void;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const useJpStore = create<JpState>()(
  persist(
    (set, get) => ({
      lessons: [],
      srs: {},
      lessonProgress: {},
      study: { learned: 0, mature: 0, streak: 0 },
      lang: 'en',

      init: () => {
        if (get().lessons.length === 0) {
          const lessons = loadAllLessons();
          set({ lessons });
          get()._computeStatuses();
        }
      },

      recordReview: (cardKey, grade) => {
        const { srs, study } = get();
        const prev = srs[cardKey] ?? createInitialSRSState(cardKey);
        const next = calculateNextReview(prev, grade);
        const newSrs = { ...srs, [cardKey]: next };

        const prevReps = prev.repetitions;
        let mature = study.mature;
        let learned = study.learned;
        if (grade >= 3 && prevReps === 0) learned++;
        if (next.interval >= 21) mature++;

        const today = todayStr();
        let streak = study.streak;
        if (study.lastStudiedDate !== today) {
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          streak = study.lastStudiedDate === yesterday ? streak + 1 : 1;
        }

        set({
          srs: newSrs,
          study: { learned, mature, streak, lastStudiedDate: today },
        });
        return next;
      },

      getDueCards: (limit = 50) => {
        const { srs } = get();
        const now = Date.now();
        return Object.values(srs)
          .filter((s) => isDue(s, now))
          .sort((a, b) => a.nextReview - b.nextReview)
          .slice(0, limit);
      },

      completeLesson: (lessonId) => {
        const { lessons, lessonProgress, srs } = get();
        const lesson = lessons.find((l) => l.id === lessonId);
        if (!lesson) return;

        // 注册 SRS 卡片
        const newSrs = { ...srs };
        for (const item of lesson.items) {
          if (item.cardRef) {
            const key = makeCardKey(PACK_ID, item.cardRef.category, item.cardRef.front);
            if (!newSrs[key]) newSrs[key] = createInitialSRSState(key);
          }
        }

        set({
          srs: newSrs,
          lessonProgress: {
            ...lessonProgress,
            [lessonId]: {
              lessonId,
              status: 'completed',
              completedAt: Date.now(),
              timesCompleted: (lessonProgress[lessonId]?.timesCompleted ?? 0) + 1,
            },
          },
        });
        get()._computeStatuses();
      },

      getLessonStatus: (lessonId) => {
        return get().lessonProgress[lessonId]?.status ?? 'locked';
      },

      resetAll: () => {
        set({
          srs: {},
          lessonProgress: {},
          study: { learned: 0, mature: 0, streak: 0 },
        });
        get()._computeStatuses();
      },

      setLang: (lang) => {
        set({ lang });
      },

      /** 全部 available（不强制跨 level 解锁） */
      _computeStatuses: () => {
        const { lessons, lessonProgress } = get();
        const updated: Record<string, LessonProgress> = { ...lessonProgress };
        let changed = false;

        for (const lesson of lessons) {
          const cur = updated[lesson.id];
          if (cur?.status === 'completed' || cur?.status === 'in_progress') continue;
          if (!cur || cur.status !== 'available') {
            updated[lesson.id] = {
              lessonId: lesson.id,
              status: 'available',
              timesCompleted: cur?.timesCompleted ?? 0,
            };
            changed = true;
          }
        }

        if (changed) set({ lessonProgress: updated });
      },
    }),
    {
      name: 'jp-study-store',
      partialize: (state) => ({
        srs: state.srs,
        lessonProgress: state.lessonProgress,
        study: state.study,
        lang: state.lang,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.init();
      },
    },
  ),
);
