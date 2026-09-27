/**
 * 存量迁移：把 studyRecord（判卷历史）里错过的句子灌进错题池。
 *
 * 不做这一步的话，所有老用户打开新错句本都是空的 —— 明明在 studyRecord 里
 * 躺着几百条「错 3 次」的记录，却要重新错一遍才能进池。
 *
 * 与单词那边形态不同：typing 的历史存在服务端 typing_word_record 里，迁移走
 * POST /review/migrate-word-wrongs；听力的学习记录是纯 localStorage
 * （studyRecord.ts 刻意只留 60 字 preview，怕顶到 5MB 上限），
 * 所以迁移只能在前端做 —— 把历史事实补录成当前掌握态。
 *
 * 只补「没有掌握态记录」的句子：已经练句子:?错了N次的、以及已经有了掌握态的都不动，
 * 重复执行也不会把 progress 冲掉。
 */

import { getReviewStore } from '../review/store.ts';
import { sentenceKey } from '../review/sentenceKeys.ts';
import { SENTENCE_DOMAIN } from '../review/sentence.ts';
import type { ReviewInput } from '../review/types.ts';
import { loadStudyRecord } from './studyRecord';

const FLAG = 'listening-review-migrated-v1';

/** 单次迁移上限：历史记录可能有几千条，全灌进来只会把错题池淹掉 */
const MAX_MIGRATE = 2000;

export async function migrateWrongSentencesOnce(): Promise<number> {
  try {
    if (localStorage.getItem(FLAG)) return 0;
  } catch {
    return 0;
  }

  const store = getReviewStore(SENTENCE_DOMAIN)();
  // 先 hydrate：本地 + 云端拉齐，否则会把别端已有的记录又刷一遍成 wrong
  await store.hydrate();

  const all = loadStudyRecord();
  const candidates: { input: ReviewInput; errors: number }[] = [];
  for (const rec of Object.values(all)) {
    for (const stat of Object.values(rec.sentenceStats)) {
      if (stat.errors <= 0) continue;
      const key = sentenceKey(rec.bookId, rec.lessonId, stat.idx);
      if (store.lookup(key)) continue;
      candidates.push({
        errors: stat.errors,
        input: {
          key,
          ok: false,
          // 每条一个独立会话：迁移是补录历史，不该被「同一会话只认第一次」吃掉
          sessionId: `migrate:${key}`,
          unitId: rec.bookId,
          mode: 'practice',
        },
      });
    }
  }

  if (candidates.length === 0) {
    try {
      localStorage.setItem(FLAG, String(Date.now()));
    } catch { /* ignore */ }
    return 0;
  }

  // 错得越多越该先进池
  candidates.sort((a, b) => b.errors - a.errors);
  store.applyResults(candidates.slice(0, MAX_MIGRATE).map((c) => c.input));
  try {
    localStorage.setItem(FLAG, String(Date.now()));
  } catch { /* ignore */ }

  return Math.min(candidates.length, MAX_MIGRATE);
}
