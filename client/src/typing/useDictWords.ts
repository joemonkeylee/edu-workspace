import { useEffect, useState } from 'react';
import { CHAPTER_LENGTH } from './engine';
import { getDict } from './dictionaries';
import type { Word } from './types';

/** 词库 JSON 的内存缓存，切回已加载过的词库时不再请求 */
const cache = new Map<string, Word[]>();

export function chapterCountOf(total: number): number {
  return Math.max(1, Math.ceil(total / CHAPTER_LENGTH));
}

export function sliceChapter(words: Word[], chapter: number): Word[] {
  const start = chapter * CHAPTER_LENGTH;
  return words.slice(start, start + CHAPTER_LENGTH);
}

function normalize(list: unknown): Word[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map((w, index) => {
      const name = typeof w.name === 'string' ? w.name : '';
      // 部分词库 trans 可能是字符串或对象，统一收敛成数组
      let trans: string[] = [];
      if (Array.isArray(w.trans)) trans = w.trans.filter((t): t is string => typeof t === 'string');
      else if (typeof w.trans === 'string') trans = [w.trans];
      return {
        name,
        trans,
        usphone: typeof w.usphone === 'string' ? w.usphone : '',
        ukphone: typeof w.ukphone === 'string' ? w.ukphone : '',
        index,
      };
    })
    .filter((w) => w.name.length > 0);
}

/** Fisher–Yates 洗牌，返回新数组 */
export function shuffle<T>(list: T[]): T[] {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 加载词库，返回全量词条 */
export function useDictWords(dictId: string) {
  const [words, setWords] = useState<Word[] | null>(() => cache.get(dictId) ?? null);
  const [loading, setLoading] = useState<boolean>(() => !cache.has(dictId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = cache.get(dictId);
    if (cached) {
      setWords(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(getDict(dictId).url)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
      })
      .then((data) => {
        const list = normalize(data);
        cache.set(dictId, list);
        if (cancelled) return;
        setWords(list);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '词库加载失败');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dictId]);

  return { words, loading, error };
}
