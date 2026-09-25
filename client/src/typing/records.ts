/**
 * 练习记录的本地存储 + 云端同步。
 *
 * 遵循项目约定：先写 localStorage，若已登录再写服务端；读取时以服务端为准，
 * 本地作为回落与补充。AUTH_ENABLED=false 时服务端直接返回空/成功，
 * 此时模块退化为纯本地运行，不会报错。
 */

import {
  listTypingChapterStats,
  listTypingWrongWords,
  saveTypingChapterRecord,
  saveTypingWordRecords,
  getTypingSummary,
  type TypingChapterStat,
  type TypingSummary,
  type TypingWordRecordPayload,
} from '@/api/client';
import type { LetterMistakes, Word } from './types';

const STORAGE_KEY = 'typing-records-v1';
/** 本地最多保留的章节记录条数 */
const MAX_CHAPTERS = 300;

export type LocalWordRec = {
  wrongCount: number;
  mistakes: LetterMistakes;
  updatedAt: number;
};

export type ChapterRec = {
  dictId: string;
  chapter: number;
  timeSec: number;
  correctCount: number;
  wrongCount: number;
  wordCount: number;
  createdAt: number;
};

type LocalStore = {
  version: 1;
  /** key = `${dictId}::${word}` */
  words: Record<string, LocalWordRec>;
  chapters: ChapterRec[];
};

export type WrongWord = {
  word: string;
  dictId: string;
  wrongCount: number;
  mistakes: LetterMistakes;
  updatedAt: number;
};

const emptyStore: LocalStore = { version: 1, words: {}, chapters: [] };

function readStore(): LocalStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...emptyStore, words: {}, chapters: [] };
    const parsed = JSON.parse(raw) as LocalStore;
    if (!parsed || parsed.version !== 1) return { ...emptyStore, words: {}, chapters: [] };
    return { version: 1, words: parsed.words ?? {}, chapters: parsed.chapters ?? [] };
  } catch {
    return { ...emptyStore, words: {}, chapters: [] };
  }
}

function writeStore(store: LocalStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* 存储配额不足时静默失败，不影响练习 */
  }
}

export function wordKey(dictId: string, word: string): string {
  return `${dictId}::${word}`;
}

/** 把一章产生的单词记录合并进本地存储（错词累加） */
export function mergeWordLogsLocal(dictId: string, logs: TypingWordRecordPayload[]) {
  if (logs.length === 0) return;
  const store = readStore();
  const now = Date.now();
  for (const log of logs) {
    if (!log.word) continue;
    const key = wordKey(dictId, log.word);
    const prev = store.words[key];
    store.words[key] = {
      wrongCount: (prev?.wrongCount ?? 0) + log.wrongCount,
      mistakes: { ...(prev?.mistakes ?? {}), ...(log.mistakes ?? {}) },
      updatedAt: now,
    };
  }
  writeStore(store);
}

export function pushChapterLocal(rec: Omit<ChapterRec, 'createdAt'>) {
  const store = readStore();
  store.chapters.push({ ...rec, createdAt: Date.now() });
  if (store.chapters.length > MAX_CHAPTERS) {
    store.chapters = store.chapters.slice(-MAX_CHAPTERS);
  }
  writeStore(store);
}

export function getLocalWrongWords(dictId?: string): WrongWord[] {
  const store = readStore();
  const prefix = dictId ? `${dictId}::` : null;
  return Object.entries(store.words)
    .filter(([key, rec]) => rec.wrongCount > 0 && (!prefix || key.startsWith(prefix)))
    .map(([key, rec]) => {
      const sep = key.indexOf('::');
      return {
        dictId: key.slice(0, sep),
        word: key.slice(sep + 2),
        wrongCount: rec.wrongCount,
        mistakes: rec.mistakes,
        updatedAt: rec.updatedAt,
      };
    })
    .sort((a, b) => b.wrongCount - a.wrongCount || b.updatedAt - a.updatedAt);
}

export function getLocalChapterStats(dictId: string): TypingChapterStat[] {
  const store = readStore();
  const map = new Map<number, TypingChapterStat>();
  for (const c of store.chapters) {
    if (c.dictId !== dictId) continue;
    const cur = map.get(c.chapter) ?? { chapter: c.chapter, sessions: 0, wordCount: 0, timeSec: 0 };
    cur.sessions += 1;
    cur.wordCount += c.wordCount;
    cur.timeSec += c.timeSec;
    map.set(c.chapter, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.chapter - b.chapter);
}

export function getLocalSummary(): TypingSummary {
  const store = readStore();
  const words = Object.values(store.words);
  return {
    practicedWords: words.length,
    wrongWords: words.filter((w) => w.wrongCount > 0).length,
    chapters: store.chapters.length,
    totalTimeSec: store.chapters.reduce((sum, c) => sum + c.timeSec, 0),
    totalWords: store.chapters.reduce((sum, c) => sum + c.wordCount, 0),
  };
}

export function clearLocalRecords(dictId?: string) {
  if (!dictId) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  const store = readStore();
  const prefix = `${dictId}::`;
  for (const key of Object.keys(store.words)) {
    if (key.startsWith(prefix)) delete store.words[key];
  }
  store.chapters = store.chapters.filter((c) => c.dictId !== dictId);
  writeStore(store);
}

// ── 云端同步（失败静默降级到本地）────────────────────────────────

/** 先落本地再推云端；云端不可用时静默失败 */
export async function syncWordLogs(dictId: string, chapter: number, logs: TypingWordRecordPayload[]) {
  mergeWordLogsLocal(dictId, logs);
  try {
    await saveTypingWordRecords(dictId, chapter, logs);
  } catch {
    /* 离线或单机模式下忽略 */
  }
}

export async function syncChapterRecord(rec: Omit<ChapterRec, 'createdAt'>) {
  pushChapterLocal(rec);
  try {
    await saveTypingChapterRecord(rec);
  } catch {
    /* 离线或单机模式下忽略 */
  }
}

/** 错词本：云端优先，与本地结果按词合并（取更大错误次数） */
export async function fetchWrongWords(dictId?: string, limit = 200): Promise<WrongWord[]> {
  const local = getLocalWrongWords(dictId).slice(0, limit);
  let remote: WrongWord[] = [];
  try {
    const rows = await listTypingWrongWords(dictId, limit);
    remote = rows.map((r) => ({
      word: r.word,
      dictId: r.dictId,
      wrongCount: r.wrongCount,
      mistakes: Object.fromEntries(
        Object.entries(r.mistakes ?? {}).map(([k, v]) => [Number(k), v]),
      ),
      updatedAt: new Date(r.updatedAt).getTime(),
    }));
  } catch {
    remote = [];
  }

  const merged = new Map<string, WrongWord>();
  for (const w of [...local, ...remote]) {
    const key = wordKey(w.dictId, w.word);
    const prev = merged.get(key);
    if (!prev || w.wrongCount > prev.wrongCount) merged.set(key, w);
  }
  return Array.from(merged.values())
    .sort((a, b) => b.wrongCount - a.wrongCount || b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/** 章节进度：云端优先，回落本地 */
export async function fetchChapterStats(dictId: string): Promise<TypingChapterStat[]> {
  try {
    const rows = await listTypingChapterStats(dictId);
    if (rows.length > 0) return rows;
  } catch {
    /* 回落本地 */
  }
  return getLocalChapterStats(dictId);
}

export async function fetchSummary(): Promise<TypingSummary> {
  try {
    const remote = await getTypingSummary();
    if (remote && (remote.practicedWords > 0 || remote.chapters > 0)) return remote;
  } catch {
    /* 回落本地 */
  }
  return getLocalSummary();
}

/** 从错词列表还原成可练习的词条（释义从原词库里回填） */
export function buildReviewWords(wrong: WrongWord[], source: Word[]): Word[] {
  const byName = new Map(source.map((w) => [w.name.toLowerCase(), w]));
  return wrong
    .map((w) => byName.get(w.word.toLowerCase()) ?? { name: w.word, trans: [], usphone: '', ukphone: '' })
    .filter(Boolean);
}
