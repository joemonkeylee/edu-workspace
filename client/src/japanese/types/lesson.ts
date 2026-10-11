/**
 * Lesson 系统类型 — 从 Forgua 移植
 */

export interface LessonItem {
  front: string;
  back: string;
  reading?: string;
  explanation?: string;
  mnemonic?: string;
  cardRef?: { category: string; front: string };
}

export type LessonStepType =
  | 'introduce'
  | 'recognize'
  | 'recall'
  | 'listen-transcribe'
  | 'fill-blank-multi'
  | 'summary';

export interface LessonStep {
  type: LessonStepType;
  title?: string;
  instruction?: string;
  itemIndices: number[];
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  level: string;
  category: string;
  /** 推荐学习顺序号（同 level 内从 1 开始） */
  order?: number;
  items: LessonItem[];
  steps: LessonStep[];
}
