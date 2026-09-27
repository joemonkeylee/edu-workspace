/**
 * 批改结论的共享定义。
 *
 * 图片模式（/book/:id）与 PDF 原生模式（/pdf/book/:id）是两套互不相干的
 * 作业表与路由，但「全对 / 有问题」的取值、预设问题、展示文案必须一致，
 * 所以收敛到这一处，两侧共用。
 */

export type GradeResult = '' | 'perfect' | 'issue';

export interface GradeResultPayload {
  result: 'perfect' | 'issue';
  issues: string[];
  comment: string;
}

/** 「有问题」时教师最常选的几类，做成一键勾选，避免每次手打 */
export const GRADE_ISSUE_PRESETS = [
  '有错题',
  '有题目没有写',
  '没做完',
  '书写潦草',
  '计算/抄写错误',
  '格式不规范',
  '解题步骤不完整',
  '订正未完成',
];

/** 后端 Json 列在旧数据上是 null，取值一律走这里兜底 */
export function parseGradeIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function hasIssue(a: { status?: string; gradeResult?: string | null }): boolean {
  return a?.status === 'graded' && a?.gradeResult === 'issue';
}

/**
 * 作业列表里那枚状态徽标。
 * 已批改的作业不再显示笼统的「已批改」，而是直接给出结论 —— 学生扫一眼
 * 就知道哪些要处理；返回 null 表示不是已批改状态，由调用方按状态渲染。
 */
export function gradeBadge(a: { status?: string; gradeResult?: string | null }): { label: string; className: string } | null {
  if (a?.status !== 'graded') return null;
  if (a.gradeResult === 'issue') {
    return { label: '有问题', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' };
  }
  if (a.gradeResult === 'perfect') {
    return { label: '全对', className: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' };
  }
  return { label: '已批改', className: 'bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-400' };
}

/** 问题标签的小 chip，两处列表共用同一套配色 */
export const GRADE_ISSUE_CHIP_CLASS =
  'rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
