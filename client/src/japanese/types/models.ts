/**
 * 日语学习模块 — 核心类型定义
 * 从 Forgua 移植，简化版（去掉 IndexedDB 相关）
 */

/** SRS 状态（SM-2 算法） */
export interface SRSState {
  cardKey: string;         // 唯一键：packId:category:front
  easeFactor: number;      // 初始 2.5，最小 1.3
  interval: number;        // 天
  repetitions: number;     // 连续正确次数
  nextReview: number;      // timestamp (ms)
  lastReview?: number;     // timestamp (ms)
}

/** SM-2 评分等级 */
export const ReviewGrade = {
  Again: 1,  // 红色 — 重置
  Hard: 3,   // 橙色 — 推进，难度下降
  Good: 4,   // 绿色 — 正常推进
  Easy: 5,   // 蓝色 — 推进，难度上升
} as const;

export type ReviewGrade = (typeof ReviewGrade)[keyof typeof ReviewGrade];

/** 一条可学习的卡片 */
export interface Card {
  cardKey: string;
  packId: string;
  level: string;
  category: string;
  front: string;
  back: string;
  reading?: string;
  tags: string[];
}

/** Lesson 进度 */
export interface LessonProgress {
  lessonId: string;
  status: 'locked' | 'available' | 'in_progress' | 'completed';
  completedAt?: number;
  timesCompleted: number;
}

/** 总体学习进度 */
export interface StudyProgress {
  learned: number;
  mature: number;         // interval >= 21 天
  streak: number;
  lastStudiedDate?: string; // YYYY-MM-DD
}
