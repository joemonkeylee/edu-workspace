/**
 * 英语精听学习记录的云同步（english_study_record / english_daily_stat 两张表）。
 *
 * 沿用项目约定：localStorage 是真身，云端失败一律静默降级；
 * 冲突按 updatedAt last-write-wins（课粒度、天粒度各一条记录）。
 *
 * 写路径：recordAttempt -> scheduleEnglishStudySync(dirtyKeys) -> 1.5s 去抖后推送。
 * 读路径：页面挂载时 syncEnglishStudyOnce() 拉云端合并（每个会话只拉一次）。
 */

import {
  listEnglishDailyStats,
  listEnglishStudyRecords,
  saveEnglishDailyStats,
  saveEnglishStudyRecords,
} from '@/api/client';
import {
  lessonKey,
  loadDailyLog,
  loadStudyRecord,
  writeDailyLogMap,
  writeStudyRecordMap,
  type LessonRecord,
  type StudyRecordMap,
} from './studyRecord';
import type { DailyLogMap } from './studyStats';

const DEBOUNCE_MS = 1500;
const MAX_PER_REQUEST = 200;

const dirtyRecordKeys = new Set<string>();
const dirtyDayKeys = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** recordAttempt 里调用：标记脏数据，去抖后推云端 */
export function scheduleEnglishStudySync(recordKeys: string[] = [], dayKeys: string[] = []): void {
  for (const k of recordKeys) dirtyRecordKeys.add(k);
  for (const k of dayKeys) dirtyDayKeys.add(k);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDirty();
  }, DEBOUNCE_MS);
}

async function flushDirty(): Promise<void> {
  const rk = [...dirtyRecordKeys];
  dirtyRecordKeys.clear();
  const dk = [...dirtyDayKeys];
  dirtyDayKeys.clear();

  try {
    if (rk.length > 0) {
      const all = loadStudyRecord();
      const rows = rk
        .map((k) => all[k])
        .filter(Boolean)
        .map((r) => ({
          bookId: r.bookId,
          lessonId: r.lessonId,
          payload: r as unknown as Record<string, unknown>,
        }));
      for (let i = 0; i < rows.length; i += MAX_PER_REQUEST) {
        await saveEnglishStudyRecords(rows.slice(i, i + MAX_PER_REQUEST));
      }
    }
    if (dk.length > 0) {
      const log = loadDailyLog();
      const rows = dk
        .filter((d) => log[d])
        .map((d) => ({ date: d, payload: log[d] as unknown as Record<string, unknown> }));
      if (rows.length > 0) await saveEnglishDailyStats(rows);
    }
  } catch {
    /* 离线 / 单机模式：本地已落盘，下次 pull 时会带上去 */
  }
}

// ── 拉取合并（每个页面会话一次）───────────────────────────────

let pullPromise: Promise<void> | null = null;

/** 幂等：同一会话多次调用只拉一次。失败静默（返回 resolved）。 */
export function syncEnglishStudyOnce(): Promise<void> {
  pullPromise ??= pullAndMerge().catch(() => {});
  return pullPromise;
}

const updatedAtOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

async function pullAndMerge(): Promise<void> {
  const [remoteRecords, remoteDaily] = await Promise.all([listEnglishStudyRecords(), listEnglishDailyStats()]);

  // ── 课程记录：按 lessonKey 比 updatedAt ──
  const localRecords = loadStudyRecord();
  const remoteMap = new Map<string, LessonRecord>();
  for (const row of remoteRecords) {
    const p = row.payload as unknown as LessonRecord;
    if (!p || typeof p !== 'object' || !p.bookId || !p.lessonId) continue;
    remoteMap.set(lessonKey(row.bookId, row.lessonId), p);
  }

  const mergedRecords: StudyRecordMap = { ...localRecords };
  const pushRecords: { bookId: string; lessonId: string; payload: Record<string, unknown> }[] = [];
  let recordsChanged = false;

  for (const [key, remote] of remoteMap) {
    const cur = localRecords[key];
    if (!cur || updatedAtOf(cur.updatedAt) < updatedAtOf(remote.updatedAt)) {
      mergedRecords[key] = remote;
      recordsChanged = true;
    }
  }
  for (const [key, cur] of Object.entries(localRecords)) {
    const remote = remoteMap.get(key);
    if (!remote || updatedAtOf(cur.updatedAt) > updatedAtOf(remote.updatedAt)) {
      pushRecords.push({ bookId: cur.bookId, lessonId: cur.lessonId, payload: cur as unknown as Record<string, unknown> });
    }
  }
  if (recordsChanged) writeStudyRecordMap(mergedRecords);

  // ── 按天统计：按 date 比 updatedAt ──
  const localDaily = loadDailyLog();
  const remoteDailyMap = new Map<string, DailyLogMap[string]>();
  for (const row of remoteDaily) {
    const p = row.payload as DailyLogMap[string];
    if (!p || typeof p !== 'object' || typeof row.date !== 'string') continue;
    remoteDailyMap.set(row.date, p);
  }

  const mergedDaily: DailyLogMap = { ...localDaily };
  const pushDaily: { date: string; payload: Record<string, unknown> }[] = [];

  for (const [date, remote] of remoteDailyMap) {
    const cur = localDaily[date];
    if (!cur || updatedAtOf(cur.updatedAt) < updatedAtOf(remote.updatedAt)) mergedDaily[date] = remote;
  }
  for (const [date, cur] of Object.entries(localDaily)) {
    const remote = remoteDailyMap.get(date);
    if (!remote || updatedAtOf(cur.updatedAt) > updatedAtOf(remote.updatedAt)) {
      pushDaily.push({ date, payload: cur as unknown as Record<string, unknown> });
    }
  }
  // 合并有变化就落本地（量小，不做逐条变更判定）
  writeDailyLogMap(mergedDaily);

  if (pushRecords.length > 0) {
    for (let i = 0; i < pushRecords.length; i += MAX_PER_REQUEST) {
      await saveEnglishStudyRecords(pushRecords.slice(i, i + MAX_PER_REQUEST));
    }
  }
  if (pushDaily.length > 0) await saveEnglishDailyStats(pushDaily);
}
