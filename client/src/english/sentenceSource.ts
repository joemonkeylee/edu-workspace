/**
 * 错句本的数据源：把一个「复习条目键」还原成能展示、能播放、能判卷的一句话。
 *
 * 掌握态里只存键（bookId::lessonId::句序），不存句子原文 —— 听力库有 14 万句，
 * 把原文塞进 localStorage 一定会爆。要展示时按 lessonId 回去取这一课的 JSON，
 * studyRecord 里同样只留 60 字 preview，思路一致。
 *
 * 两级缓存都在模块级：
 *   单课 JSON      —— 翻页、重开面板、从列表进练习都不该重复网络请求
 *   索引（课名）   —— 由 review/sentence.ts 管，那里本来就要用它算进度
 */

import { useEffect, useState } from 'react';
import { RESOURCE_BASE_URL } from './appConfig';
import { BOOKS } from './constants';
import { bookLessons } from '../review/sentence.ts';
import { parseSentenceKey, type SentenceRef } from '../review/sentenceKeys.ts';

interface RawSentence {
  Id?: string;
  Start?: string | number;
  End?: string | number;
  Sentence?: string;
  Trans?: string;
}

export interface LessonJson {
  data?: RawSentence[];
  mp3?: string;
}

export type SentenceSource = {
  /** 原句，判卷与展示共用 */
  text: string;
  trans: string;
  /** 这一句在整课音频里的区间（秒） */
  start: number;
  end: number;
  /** 可直接喂给 <audio src> 的完整地址 */
  audioSrc: string;
  bookName: string;
  lessonTitle: string;
  /** 课在书里的下标，用于「第 N 课」 */
  lessonIdx: number;
};

const lessonCache = new Map<string, Promise<LessonJson | null>>();

/** 一课的 JSON：data 里每一条就是一句，带 Start / End 时间轴 */
export function loadLesson(lessonId: string): Promise<LessonJson | null> {
  const hit = lessonCache.get(lessonId);
  if (hit) return hit;
  const p = fetch(`${RESOURCE_BASE_URL}/data/lt/${lessonId}.json`)
    .then((r) => (r.ok ? (r.json() as Promise<LessonJson>) : null))
    .catch(() => null);
  lessonCache.set(lessonId, p);
  return p;
}

/** 单条取用：练习会话走到某一句时按需调用 */
export async function fetchSentence(ref: SentenceRef): Promise<SentenceSource | null> {
  const [lesson, lessons] = await Promise.all([loadLesson(ref.lessonId), bookLessons(ref.bookId)]);
  const row = lesson?.data?.[ref.idx];
  if (!row) return null;
  const lessonIdx = lessons.findIndex((l) => l.id === ref.lessonId);
  return {
    text: String(row.Sentence ?? ''),
    trans: String(row.Trans ?? ''),
    start: Number(row.Start ?? 0) || 0,
    end: Number(row.End ?? 0) || 0,
    audioSrc: `${RESOURCE_BASE_URL}/lt/${lesson?.mp3 ?? ''}`,
    bookName: BOOKS.find((b) => b.id === ref.bookId)?.name ?? ref.bookId,
    lessonTitle: lessons[lessonIdx]?.title ?? '',
    lessonIdx,
  };
}

export type SourceMap = Record<string, SentenceSource | undefined>;

/**
 * 批量补齐若干条目键对应的句子。
 *
 * 只处理当前要显示的那些 key —— 错题池可能有几千条，全展开等于把整本教材拉下来。
 * 依赖里用 join 后的字符串而不是数组本身：每次渲染新建数组会让 effect 无限循环。
 */
export function useSentenceSources(keys: string[]): { map: SourceMap; loading: boolean } {
  const [map, setMap] = useState<SourceMap>({});
  const [loading, setLoading] = useState(true);
  const signature = keys.join(',');

  useEffect(() => {
    let cancelled = false;
    const refs = new Map<string, SentenceRef>();
    for (const key of keys) {
      const ref = parseSentenceKey(key);
      if (ref) refs.set(key, ref);
    }
    if (refs.size === 0) {
      setMap({});
      setLoading(false);
      return;
    }
    setLoading(true);

    void (async () => {
      const next: SourceMap = {};

      // 课名与课序来自索引，按书聚合一次即可
      const bookIds = new Set([...refs.values()].map((r) => r.bookId));
      const titleOf = new Map<string, { title: string; idx: number }>();
      await Promise.all(
        [...bookIds].map(async (bookId) => {
          const lessons = await bookLessons(bookId);
          lessons.forEach((l, i) => {
            if (l.id) titleOf.set(l.id, { title: l.title, idx: i });
          });
        }),
      );

      // 同一课的多个句子共用一次请求
      const byLesson = new Map<string, string[]>();
      for (const [key, ref] of refs) {
        const bucket = byLesson.get(ref.lessonId) ?? [];
        bucket.push(key);
        byLesson.set(ref.lessonId, bucket);
      }

      await Promise.all(
        [...byLesson.entries()].map(async ([lessonId, keysInLesson]) => {
          const lesson = await loadLesson(lessonId);
          for (const key of keysInLesson) {
            const ref = refs.get(key)!;
            const row = lesson?.data?.[ref.idx];
            if (!row) continue;
            const meta = titleOf.get(ref.lessonId);
            next[key] = {
              text: String(row.Sentence ?? ''),
              trans: String(row.Trans ?? ''),
              start: Number(row.Start ?? 0) || 0,
              end: Number(row.End ?? 0) || 0,
              audioSrc: `${RESOURCE_BASE_URL}/lt/${lesson?.mp3 ?? ''}`,
              bookName: BOOKS.find((b) => b.id === ref.bookId)?.name ?? ref.bookId,
              lessonTitle: meta?.title ?? '',
              lessonIdx: meta?.idx ?? -1,
            };
          }
        }),
      );

      if (cancelled) return;
      setMap(next);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return { map, loading };
}
