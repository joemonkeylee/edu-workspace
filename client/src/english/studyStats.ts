/**
 * 英语精听的按天统计（纯函数，无副作用，可用 node --experimental-strip-types 直接断言）。
 *
 * 为什么存在这个文件：studyRecord.ts 里的 SentenceStat 只有每句的
 * firstSubmittedAt / lastSubmittedAt，历史判卷没有逐次时间戳，
 * 「昨天判了几次」无法从存量数据反推 —— 所以在 recordAttempt 时顺手
 * 累加一个按天的聚合日志（本地 localStorage + 云端 EnglishDailyStat）。
 *
 * 存量说明：这个日志从上线当天开始累计，之前的日子没有数据，属预期。
 */

/** 本地时区的 YYYY-MM-DD（与 typing/stats.ts 的 dateKey 同口径） */
export function localDateKey(now: number | Date = Date.now()): string {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type DayAgg = {
  date: string;
  /** 判卷次数（manual / inTime，与 recordAttempt 的 counted 口径一致） */
  attempts: number;
  /** 判错次数 */
  errors: number;
  /** 判卷通过次数 */
  passes: number;
  /** 首次判卷即通过的句子数 */
  firstPasses: number;
  /** 当天第一次练到的句子数 */
  newSentences: number;
  /** 当天碰过的课（bookId::lessonId），上限 64 个，防日志被长尾撑爆 */
  lessons: string[];
  /** 该天聚合最后一次更新的毫秒时间戳，云端合并用 */
  updatedAt: number;
};

export function emptyDayAgg(date: string, now = Date.now()): DayAgg {
  return { date, attempts: 0, errors: 0, passes: 0, firstPasses: 0, newSentences: 0, lessons: [], updatedAt: now };
}

export type BumpEvent = {
  lessonKey: string;
  /** 本次判卷是否通过 */
  passed: boolean;
  /** 该句是否为有记录以来的第一次判卷（即当天「新句子」） */
  isFirstAttemptOfSentence: boolean;
};

/** 在某天的聚合上累加一次判卷 */
export function bumpDayAgg(prev: DayAgg | undefined, date: string, ev: BumpEvent, now = Date.now()): DayAgg {
  const next: DayAgg = prev?.date === date ? { ...prev, lessons: [...prev.lessons] } : emptyDayAgg(date, now);
  next.attempts += 1;
  if (ev.passed) next.passes += 1;
  else next.errors += 1;
  if (ev.isFirstAttemptOfSentence) {
    next.newSentences += 1;
    if (ev.passed) next.firstPasses += 1;
  }
  if (!next.lessons.includes(ev.lessonKey)) {
    next.lessons.push(ev.lessonKey);
    if (next.lessons.length > 64) next.lessons.shift();
  }
  next.updatedAt = now;
  return next;
}

/** date 升序保留最近 keepDays 天（含今天），返回清理后的副本 */
export function pruneDays(
  log: Record<string, DayAgg>,
  keepDays = 90,
  now = Date.now(),
): Record<string, DayAgg> {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - (keepDays - 1));
  const cutoffKey = localDateKey(cutoff);

  const out: Record<string, DayAgg> = {};
  for (const [date, agg] of Object.entries(log)) {
    if (date >= cutoffKey) out[date] = agg;
  }
  return out;
}

/** key = YYYY-MM-DD 的按天日志（localStorage 与云端共用这个交换格式） */
export type DailyLogMap = Record<string, DayAgg>;

export function dayKeysOfLastDays(days: number, now = Date.now()): string[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(localDateKey(d));
  }
  return out;
}
