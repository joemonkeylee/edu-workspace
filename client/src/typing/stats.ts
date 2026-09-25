/**
 * 统计页的纯聚合函数：星级、按天趋势、连续打卡、键位热力。
 *
 * 全部无副作用、不碰 DOM 和网络，方便用 node --experimental-strip-types 直接单测。
 * 时间入参都显式传入（默认 Date.now()），测试可注入固定时间。
 */

import type { LetterMistakes } from './types';

export type ChapterLike = {
  dictId: string;
  chapter: number;
  timeSec: number;
  correctCount: number;
  wrongCount: number;
  wordCount: number;
  createdAt: number;
};

/** 本地时区的 YYYY-MM-DD */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── 星级 ────────────────────────────────────────────────────────

/** 按字母正确率定星：>=98% 三星，>=90% 两星，>=60% 一星 */
export function starsFor(accuracy: number): 0 | 1 | 2 | 3 {
  if (accuracy >= 98) return 3;
  if (accuracy >= 90) return 2;
  if (accuracy >= 60) return 1;
  return 0;
}

export function accuracyOf(c: { correct?: number; wrong?: number; correctCount?: number; wrongCount?: number }): number {
  const correct = (c.correct ?? c.correctCount) ?? 0;
  const wrong = (c.wrong ?? c.wrongCount) ?? 0;
  const total = correct + wrong;
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

// ── 按天聚合 ────────────────────────────────────────────────────

export type DailyAgg = {
  date: string;
  chapters: number;
  words: number;
  timeSec: number;
  correct: number;
  wrong: number;
};

/** 把章节记录按本地日期聚合成 Map，key = YYYY-MM-DD */
export function dailyMap(chapters: ChapterLike[], now = Date.now()): Map<string, DailyAgg> {
  const map = new Map<string, DailyAgg>();
  for (const c of chapters) {
    // 过滤脏数据：未来时间的记录不参与统计
    if (c.createdAt > now + 60_000) continue;
    const key = dateKey(new Date(c.createdAt));
    const cur = map.get(key) ?? { date: key, chapters: 0, words: 0, timeSec: 0, correct: 0, wrong: 0 };
    cur.chapters += 1;
    cur.words += c.wordCount;
    cur.timeSec += c.timeSec;
    cur.correct += c.correctCount;
    cur.wrong += c.wrongCount;
    map.set(key, cur);
  }
  return map;
}

/** 最近 days 天（含今天）的连续序列，无数据的天补零，供趋势图直接渲染 */
export function aggregateDaily(chapters: ChapterLike[], days: number, now = Date.now()): DailyAgg[] {
  const map = dailyMap(chapters, now);
  const out: DailyAgg[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    out.push(map.get(key) ?? { date: key, chapters: 0, words: 0, timeSec: 0, correct: 0, wrong: 0 });
  }
  return out;
}

/** 今天累计练习词数 */
export function wordsToday(chapters: ChapterLike[], now = Date.now()): number {
  const key = dateKey(new Date(now));
  return dailyMap(chapters, now).get(key)?.words ?? 0;
}

// ── 连续打卡 ────────────────────────────────────────────────────

export type Streak = {
  /** 连续天数（今天没练但昨天练了时仍保留，今天练满则 +1 从今天起算） */
  current: number;
  /** 数据集中的历史最长连续 */
  longest: number;
  /** 今天是否已有练习 */
  todayDone: boolean;
};

export function calcStreak(chapters: ChapterLike[], now = Date.now()): Streak {
  const map = dailyMap(chapters, now);
  const practiced = new Set([...map.keys()].filter((k) => (map.get(k)?.words ?? 0) > 0));

  const todayKey = dateKey(new Date(now));
  const todayDone = practiced.has(todayKey);

  // current：从「今天」或「昨天」开始往回数
  let current = 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!todayDone) cursor.setDate(cursor.getDate() - 1);
  while (practiced.has(dateKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // longest：集合内排序后线性扫描
  const sorted = [...practiced].sort();
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const key of sorted) {
    const d = new Date(`${key}T00:00:00`);
    if (prev && (d.getTime() - prev.getTime()) / 86_400_000 === 1) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = d;
  }

  return { current, longest, todayDone };
}

// ── 键位热力 ────────────────────────────────────────────────────

export type KeyHeat = {
  /** 易错键：想按这个键却打错了，count = 累计错输次数 */
  missed: Record<string, number>;
  /** 误按键：实际按下去的错字符，count = 次数 */
  wrongPressed: Record<string, number>;
};

/**
 * 从错词记录聚合键位热度。
 * mistakes 是 { 字母下标: [错输字符...] }，配合单词本身可反推出「本想按的键」。
 */
export function aggregateKeyHeat(
  wrongWords: { word: string; mistakes: LetterMistakes }[],
): KeyHeat {
  const missed: Record<string, number> = {};
  const wrongPressed: Record<string, number> = {};

  for (const ww of wrongWords) {
    for (const [idxStr, chars] of Object.entries(ww.mistakes ?? {})) {
      const idx = Number(idxStr);
      const target = ww.word[idx];
      // 目标字符：单字母键位（词组里的空格计到 space）
      if (typeof target === 'string' && target.length === 1) {
        const key = target === ' ' ? 'space' : target.toLowerCase();
        missed[key] = (missed[key] ?? 0) + chars.length;
      }
      for (const ch of chars) {
        const key = ch === ' ' ? 'space' : ch.toLowerCase();
        wrongPressed[key] = (wrongPressed[key] ?? 0) + 1;
      }
    }
  }
  return { missed, wrongPressed };
}
