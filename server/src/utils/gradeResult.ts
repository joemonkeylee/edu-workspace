/**
 * 批改结论的规范化工具。
 *
 * 图片模式（assignment）与 PDF 模式（pdf_assignment）是两张表两套路由，
 * 但「全对 / 有问题」的取值规则必须一致，所以收敛到这里共享。
 *
 * 取值约定：
 *   gradeResult  '' | perfect | issue        —— '' 表示教师还没下结论
 *   gradeIssues  string[]                    —— 仅 issue 时有意义，空数组表示未细分
 *   gradeComment string                      —— 教师备注，可空
 */

export const GRADE_RESULT_VALUES = ['', 'perfect', 'issue'] as const;
export type GradeResult = (typeof GRADE_RESULT_VALUES)[number];

const MAX_ISSUES = 20;
const MAX_ISSUE_LEN = 30;
const MAX_COMMENT_LEN = 500;

export function normalizeGradeResult(value: unknown): GradeResult {
  return value === 'perfect' || value === 'issue' ? value : '';
}

/** 去重、去空、截断，长度上限同时防止恶意 payload 撑爆 JSON 列 */
export function normalizeGradeIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim().slice(0, MAX_ISSUE_LEN);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function normalizeGradeComment(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_COMMENT_LEN) : '';
}

/**
 * 一次性算出要写库的三个字段。
 * 只有 graded 才保留结论；退回/重新提交一律清空，避免学生看到上一轮的过期问题。
 */
export function buildGradeFields(input: {
  result?: unknown;
  issues?: unknown;
  comment?: unknown;
}, status: string) {
  if (status !== 'graded') {
    return { gradeResult: '', gradeIssues: [], gradeComment: '' };
  }
  const result = normalizeGradeResult(input.result);
  const issues = result === 'issue' ? normalizeGradeIssues(input.issues) : [];
  return { gradeResult: result, gradeIssues: issues, gradeComment: normalizeGradeComment(input.comment) };
}
