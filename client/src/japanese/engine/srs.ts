/**
 * SM-2 间隔重复引擎 — 从 Forgua 移植
 * 纯函数，零依赖
 */

import type { SRSState, ReviewGrade } from '../types/models';
import { ReviewGrade as RG } from '../types/models';

/** EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)), min 1.3 */
function calcEF(currentEF: number, grade: number): number {
  const q = grade;
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  return Math.max(1.3, currentEF + delta);
}

/** SM-2 核心调度逻辑 */
export function calculateNextReview(state: SRSState, grade: ReviewGrade): SRSState {
  const now = Date.now();
  const newEF = calcEF(state.easeFactor, grade);
  const gradeVal = grade as number;

  let newInterval: number;
  let newReps: number;

  if (gradeVal >= RG.Hard) {
    if (state.repetitions === 0) newInterval = 1;
    else if (state.repetitions === 1) newInterval = 6;
    else newInterval = Math.round(state.interval * newEF);
    newReps = state.repetitions + 1;
  } else {
    newInterval = 1;
    newReps = 0;
  }

  return {
    cardKey: state.cardKey,
    easeFactor: newEF,
    interval: newInterval,
    repetitions: newReps,
    nextReview: now + newInterval * 86400000, // days → ms
    lastReview: now,
  };
}

/** 新建卡片的初始状态 */
export function createInitialSRSState(cardKey: string): SRSState {
  return {
    cardKey,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: Date.now(), // 立即可复习
  };
}

/** 判断一张卡今天是否到期 */
export function isDue(state: SRSState, now = Date.now()): boolean {
  return state.nextReview <= now;
}
