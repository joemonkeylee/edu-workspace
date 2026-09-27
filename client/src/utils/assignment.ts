export function formatAssignmentTitle(title: string | null | undefined): string {
  if (!title) return '';
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(title);
  if (!match) return title;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
}

/** 分钟数转友好时长：30→"30分钟"，90→"1小时30分钟"，0→"不限时" */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return '';
  const m = Math.round(minutes);
  if (m <= 0) return '不限时';
  if (m < 60) return `${m}分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}小时` : `${h}小时${r}分钟`;
}

/** 计算作业实际用时（分钟）：submittedAt - createdAt，未提交则返回 null */
export function actualMinutes(assignment: { createdAt?: string; submittedAt?: string | null }): number | null {
  if (!assignment.createdAt || !assignment.submittedAt) return null;
  const diff = new Date(assignment.submittedAt).getTime() - new Date(assignment.createdAt).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff / 60000);
}

export const ESTIMATED_MINUTE_PRESETS = [0, 30, 40, 45, 60, 90, 120];
