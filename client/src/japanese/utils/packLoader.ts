/**
 * 加载日语 pack — lessons / grammar / readings
 * 用 import.meta.glob 把所有 JSON 动态导入
 */

import type { Lesson } from '../types/lesson';

// 动态 import — 注意：path 相对于本文件
const lessonModules = import.meta.glob('/src/japanese/packs/japanese/lessons/*.json', { eager: true });
const grammarModules = import.meta.glob('/src/japanese/packs/japanese/grammar/*.json', { eager: true });

function lessonIdFromPath(p: string): string {
  return p.split('/').pop()!.replace('.json', '');
}

/** 加载全部 lessons */
export function loadAllLessons(): Lesson[] {
  const lessons: Lesson[] = [];
  for (const [, mod] of Object.entries(lessonModules)) {
    const data = (mod as { default: Lesson }).default;
    if (data && data.id) lessons.push(data);
  }
  // 排序：先按 level（n5 → n4 → n3，越基础越靠前），再按 category，再按文件名
  lessons.sort((a, b) => {
    const levelOrder = ['n5', 'n4', 'n3', 'n2', 'n1'];
    const lvA = levelOrder.indexOf(a.level);
    const lvB = levelOrder.indexOf(b.level);
    if (lvA !== lvB) return lvA - lvB;
    const catOrder = ['characters', 'mixed', 'vocabulary', 'grammar', 'reading'];
    const catA = catOrder.indexOf(a.category);
    const catB = catOrder.indexOf(b.category);
    if (catA !== catB) return catA - catB;
    return a.id.localeCompare(b.id);
  });
  // 给每课打上全局递增推荐学习顺序号
  lessons.forEach((l, idx) => {
    (l as Lesson & { order: number }).order = idx + 1;
  });
  return lessons;
}

/** 加载全部 grammar points */
export function loadAllGrammar(): Record<string, unknown>[] {
  const points: Record<string, unknown>[] = [];
  for (const [, mod] of Object.entries(grammarModules)) {
    const arr = (mod as { default: Record<string, unknown>[] }).default;
    if (Array.isArray(arr)) points.push(...arr);
  }
  return points;
}

/** 从 front 找 lesson */
export function findLessonById(lessons: Lesson[], id: string): Lesson | undefined {
  return lessons.find((l) => l.id === id);
}

/** 生成 cardKey */
export function makeCardKey(packId: string, category: string, front: string): string {
  return `${packId}:${category}:${front}`;
}
