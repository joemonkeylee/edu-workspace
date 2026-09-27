/**
 * 复习引擎的断言脚本（不需要测试框架）。
 *
 * 跑法：
 *   node --experimental-strip-types scripts/verify-review-engine.ts
 *
 * 注意：Node 只对 .ts 文件做类型擦除，所以本文件必须是 .ts 而不是 .mjs；
 * 相对 import 也必须带 .ts 后缀（Node ESM 不会自动补）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyResult,
  computeProgress,
  markKnown,
  mergeProgress,
  mergeStates,
  normalizeItemKey,
  reopenWrong,
  emptyItemState,
} from '../client/src/review/engine.ts';
import { lookupState, putStates, emptyBuckets } from '../client/src/review/repository.ts';
import { buildMixedQueue, pickSpotCheck } from '../client/src/review/queue.ts';
import { DEFAULT_REVIEW_CONFIG, type ReviewConfig, type ReviewInput, type ReviewProgress, type ReviewTransition } from '../client/src/review/types.ts';
import { sentenceKey, sentenceKeys, parseSentenceKey } from '../client/src/review/sentenceKeys.ts';
import { judge, judgeMistakes } from '../client/src/english/judge.ts';
import { bumpDayAgg, emptyDayAgg, localDateKey, pruneDays, dayKeysOfLastDays } from '../client/src/english/studyStats.ts';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log('  ✓', name);
}

const cfg: ReviewConfig = { ...DEFAULT_REVIEW_CONFIG };
let now = 1_700_000_000_000;
const tick = () => (now += 1000);

/** 连续施加若干次结果 */
function run(initial: ReviewItemState | undefined, inputs: Array<Partial<ReviewInput>>, c: ReviewConfig = cfg) {
  let cur = initial;
  const transitions: ReviewTransition[] = [];
  for (const raw of inputs) {
    const merged: ReviewInput = { key: '', ok: false, sessionId: '', now: tick(), ...raw };
    const { state, transition } = applyResult(cur, merged, c);
    cur = state;
    transitions.push(transition);
  }
  return { state: cur, transitions };
}

console.log('\n── 键归一化 ──');
check('大小写 / 首尾空格归一', () => {
  assert.equal(normalizeItemKey('  Abandon '), 'abandon');
  assert.equal(normalizeItemKey('ABANDON'), normalizeItemKey('abandon'));
});

console.log('\n── 入池与晋级 ──');
check('首次答错 → 错题池', () => {
  const { state, transitions } = run(undefined, [{ key: 'abandon', ok: false, sessionId: 's1', unitId: 'cet4' }]);
  assert.equal(state.status, 'wrong');
  assert.equal(state.wrongTotal, 1);
  assert.equal(transitions[0], 'to-wrong');
  assert.deepEqual(state.units, ['cet4']);
});

check('连答对 reviewPassCount(2) → 备用池，且清掉字母级明细', () => {
  let cur;
  cur = applyResult(undefined, { key: 'accept', ok: false, sessionId: 's1', mistakes: { 2: ['c'] } }, cfg).state;
  assert.equal(cur.status, 'wrong');
  assert.ok(cur.mistakes);
  const withOutOnes = [{ key: 'accept', ok: true, sessionId: 's2' }, { key: 'accept', ok: true, sessionId: 's3' }];
  const { state, transitions } = run(cur, withOutOnes);
  assert.equal(state.status, 'standby');
  assert.equal(state.mistakes, undefined);
  assert.deepEqual(transitions, ['none', 'to-standby']);
});

check('错题途中又错一次 → 已攒进度清零', () => {
  let cur = applyResult(undefined, { key: 'beside', ok: false, sessionId: 's1' }, cfg).state;
  cur = applyResult(cur, { key: 'beside', ok: true, sessionId: 's2' }, cfg).state;
  assert.equal(cur.reviewStreak, 1);
  cur = applyResult(cur, { key: 'beside', ok: false, sessionId: 's3' }, cfg).state;
  assert.equal(cur.status, 'wrong');
  assert.equal(cur.reviewStreak, 0);
  assert.equal(cur.wrongTotal, 2);
});

check('同一会话内重复命中同一个词只生效一次', () => {
  let cur = applyResult(undefined, { key: 'cabin', ok: false, sessionId: 's1' }, cfg).state;
  const { state, transitions } = run(cur, [
    { key: 'cabin', ok: true, sessionId: 's9' },
    { key: 'cabin', ok: true, sessionId: 's9' },
    { key: 'cabin', ok: true, sessionId: 's9' },
  ]);
  assert.deepEqual(transitions, ['none', 'dup', 'dup']);
  assert.equal(state.status, 'wrong');
  assert.equal(state.reviewStreak, 1);
});

check('偷看答案（peeked）不计对也不计错', () => {
  const cur = applyResult(undefined, { key: 'dairy', ok: false, sessionId: 's1' }, cfg).state;
  const { state, transitions } = run(cur, [{ key: 'dairy', ok: true, sessionId: 's2', peeked: true }]);
  assert.equal(transitions[0], 'peeked');
  assert.equal(state.reviewStreak, 0);
  assert.equal(state.rightTotal, 0);
});

check('偷看答案不会占掉这次会话的晋级名额', () => {
  let cur = applyResult(undefined, { key: 'eagle', ok: false, sessionId: 's1' }, cfg).state;
  // 同一会话里先偷看一次，再真正打对 —— 后面那次必须生效
  cur = applyResult(cur, { key: 'eagle', ok: true, sessionId: 's2', peeked: true }, cfg).state;
  const after = applyResult(cur, { key: 'eagle', ok: true, sessionId: 's2' }, cfg);
  assert.equal(after.transition, 'none');
  assert.equal(after.state.reviewStreak, 1);
});

check('第一次就答对 → 不进错题池，记为 none（已接触）', () => {
  const { state } = run(undefined, [{ key: 'eager', ok: true, sessionId: 's1' }]);
  assert.equal(state.status, 'none');
  assert.equal(state.rightTotal, 1);
});

console.log('\n── 备用池抽查与毕业 ──');
const standby = () => {
  let cur = applyResult(undefined, { key: 'fable', ok: false, sessionId: 's1' }, cfg).state;
  cur = applyResult(cur, { key: 'fable', ok: true, sessionId: 's2' }, cfg).state;
  cur = applyResult(cur, { key: 'fable', ok: true, sessionId: 's3' }, cfg).state;
  assert.equal(cur.status, 'standby');
  return cur;
};

check('抽查通过 graduateAfterCheckPass(3) → 毕业', () => {
  const { state, transitions } = run(standby(), [
    { key: 'fable', ok: true, sessionId: 'c1', mode: 'spotcheck' },
    { key: 'fable', ok: true, sessionId: 'c2', mode: 'spotcheck' },
    { key: 'fable', ok: true, sessionId: 'c3', mode: 'spotcheck' },
  ]);
  assert.equal(state.status, 'mastered');
  assert.deepEqual(transitions, ['none', 'none', 'to-mastered']);
});

check('抽查错一次只是扣满分池出不掉（M=2）', () => {
  let cur = standby();
  cur = applyResult(cur, { key: 'fable', ok: true, sessionId: 'c1', mode: 'spotcheck' }, cfg).state;
  assert.equal(cur.checkStreak, 1);
  const { state } = run(cur, [{ key: 'fable', ok: false, sessionId: 'c2', mode: 'spotcheck' }]);
  assert.equal(state.status, 'standby');
  assert.equal(state.checkStreak, 0);
  assert.equal(state.checkFailStreak, 1);
});

check('抽查累计错够 M 次 → 退回错题池', () => {
  let cur = standby();
  const { state, transitions } = run(cur, [
    { key: 'fable', ok: false, sessionId: 'c1', mode: 'spotcheck' },
    { key: 'fable', ok: false, sessionId: 'c2', mode: 'spotcheck' },
  ]);
  assert.equal(state.status, 'wrong');
  assert.equal(state.reviewStreak, 0);
  assert.equal(state.checkFailStreak, 0);
  assert.deepEqual(transitions, ['none', 'to-wrong']);
});

check('毕业的词在主线答错仍会被拽回（masteredWrongReturnsToPool）', () => {
  let cur = standby();
  for (const sid of ['c1', 'c2', 'c3']) {
    cur = applyResult(cur, { key: 'fable', ok: true, sessionId: sid, mode: 'spotcheck' }, cfg).state;
  }
  assert.equal(cur.status, 'mastered');
  const hit = applyResult(cur, { key: 'fable', ok: false, sessionId: 'p1', mode: 'practice' }, cfg);
  assert.equal(hit.state.status, 'wrong');
  assert.equal(hit.transition, 'to-wrong');

  const immune = applyResult(
    cur,
    { key: 'fable', ok: false, sessionId: 'p2', mode: 'practice' },
    { ...cfg, masteredWrongReturnsToPool: false },
  );
  assert.equal(immune.state.status, 'mastered');
});

check('graduateAfterCheckPass=0 永不毕业（永远留在备用池被抽查）', () => {
  const loopCfg = { ...cfg, graduateAfterCheckPass: 0 };
  let cur = standby();
  for (const sid of ['c1', 'c2', 'c3', 'c4']) {
    cur = applyResult(cur, { key: 'fable', ok: true, sessionId: sid, mode: 'spotcheck' }, loopCfg).state;
  }
  assert.equal(cur.status, 'standby');
  assert.equal(cur.checkStreak, 4);
});

console.log('\n── 手动操作 ──');
check('手动「认识了」→ 默认进备用池（仍会被抽查验证）', () => {
  const wrong = applyResult(undefined, { key: 'giant', ok: false, sessionId: 's1' }, cfg).state;
  const s = markKnown(wrong, cfg);
  assert.equal(s.status, 'standby');
  assert.equal(s.checkFailStreak, 0);

  assert.equal(markKnown(wrong, { ...cfg, manualKnowTarget: 'mastered' }).status, 'mastered');
});

check('手动放回错题池', () => {
  const s = reopenWrong(standby());
  assert.equal(s.status, 'wrong');
  assert.equal(s.reviewStreak, 0);
  assert.ok(s.firstWrongAt > 0);
});

console.log('\n── 进度计算 ──');
const mk = (key: string, status: ReviewItemState['status']): ReviewItemState =>
  ({ ...emptyItemState(key), status });

check('掌握率 = (备用 + 毕业) / 去重词条总数', () => {
  const words = ['a', 'b', 'c', 'd', 'e'];
  const map = { a: mk('a', 'wrong'), b: mk('b', 'standby'), c: mk('c', 'mastered'), e: mk('e', 'none') };
  const p = computeProgress(words, (k) => map[k]);
  assert.equal(p.total, 5);
  assert.equal(p.wrong, 1);
  assert.equal(p.masteredRate, 2 / 5);
  assert.equal(p.coveredRate, 4 / 5);
  assert.equal(p.ungraded, 1);
  // d 从没打过照面，不能算进覆盖率
  assert.equal(p.untouched, 1);
});

check('加权合并：大词库不会被小词库带偏', () => {
  const big: ReviewProgress = { total: 1000, ungraded: 0, untouched: 0, wrong: 0, standby: 500, mastered: 500, masteredRate: 1, coveredRate: 1 };
  const small: ReviewProgress = { total: 10, ungraded: 0, untouched: 0, wrong: 10, standby: 0, mastered: 0, masteredRate: 0, coveredRate: 1 };
  const m = mergeProgress([big, small]);
  assert.equal(m.total, 1010);
  assert.ok(Math.abs(m.masteredRate - 1000 / 1010) < 1e-9);
});

check('跨端合并按 updatedAt 取新，units 归并', () => {
  const local = { ...mk('x', 'wrong'), updatedAt: 100, units: ['cet4'] };
  const remote = { ...mk('x', 'standby'), updatedAt: 200, units: ['cet6'] };
  assert.equal(mergeStates(local, remote).status, 'standby');
  assert.deepEqual(mergeStates(local, remote).units, ['cet4', 'cet6']);
  // 本地更新时保留本地
  assert.equal(mergeStates({ ...local, updatedAt: 300 }, remote).status, 'wrong');
});

console.log('\n── 存储分桶 ──');
check('三桶存放与查询', () => {
  let b = emptyBuckets();
  b = putStates(b, [mk('a', 'wrong'), mk('b', 'standby'), mk('c', 'mastered'), mk('d', 'none')]);
  assert.equal(lookupState(b, 'a').status, 'wrong');
  assert.equal(lookupState(b, 'c').status, 'mastered');
  assert.equal(lookupState(b, 'd').status, 'none');
  assert.equal(lookupState(b, 'zzz'), undefined);
  // 迁移后旧的桶不能残留
  b = putStates(b, [mk('c', 'wrong')]);
  assert.equal(lookupState(b, 'c').status, 'wrong');
  assert.equal(b.mastered.has('c'), false);
});

console.log('\n── 队列混入与抽查选取 ──');
check('混入比例生效且不与本章词重复', () => {
  const main = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'];
  const standbyList = ['w9', 's1', 's2'];
  const { queue, injectedKeys } = buildMixedQueue({
    main,
    standby: standbyList,
    keyOf: (x) => x,
    ratio: 0.2,
    mode: 'tail',
  });
  assert.equal(queue.length, 12);
  assert.deepEqual([...injectedKeys], ['s1', 's2']);
  assert.equal(new Set(queue).size, queue.length);
});

check('interleave 模式把备用词插进中间', () => {
  const { queue } = buildMixedQueue({
    main: Array.from({ length: 10 }, (_, i) => `w${i}`),
    standby: ['s1', 's2'],
    keyOf: (x) => x,
    ratio: 0.2,
    mode: 'interleave',
  });
  const firstStandbyAt = queue.findIndex((x) => x.startsWith('s'));
  assert.ok(firstStandbyAt > 0 && firstStandbyAt < queue.length - 1);
});

check('比例为 0 时不混入', () => {
  const { queue, injectedKeys } = buildMixedQueue({
    main: ['w1'], standby: ['s1'], keyOf: (x) => x, ratio: 0, mode: 'tail',
  });
  assert.equal(injectedKeys.size, 0);
  assert.equal(queue.length, 1);
});

check('抽查优先挑最久没抽查过的', () => {
  const pool = [
    { key: 'recent', lastCheckAt: 9_000 },
    { key: 'never', lastCheckAt: 0 },
    { key: 'old', lastCheckAt: 100 },
  ];
  const picked = pickSpotCheck(pool, { count: 2, lastCheckAtOf: (x) => x.lastCheckAt, random: () => 0.5 });
  assert.deepEqual(picked.map((p) => p.key), ['never', 'old']);
});

// ── 听力单句领域 ────────────────────────────────────────────────
console.log('\n── 听力单句领域 ──');

const BOOK = 'b'.repeat(32);
const LESSON = 'c'.repeat(32);

check('句子键：编解码往返一致', () => {
  const key = sentenceKey(BOOK, LESSON, 7);
  assert.equal(key, `${BOOK}::${LESSON}::7`);
  const ref = parseSentenceKey(key);
  assert.deepEqual(ref, { bookId: BOOK, lessonId: LESSON, idx: 7 });
  // 键要能用 VarChar(191) 存下，并且归一化不会改坏
  assert.ok(key.length <= 191);
  assert.equal(normalizeItemKey(key), key.toLowerCase());
});

check('句子键：同一句话在不同书里是两条（英音/美音不互相买单）', () => {
  const a = sentenceKey('book-british', LESSON, 3);
  const b = sentenceKey('book-american', LESSON, 3);
  assert.notEqual(a, b);
});

check('句子键：坏输入返回 null 而不是抛错', () => {
  assert.equal(parseSentenceKey(''), null);
  assert.equal(parseSentenceKey('a::b'), null);
  assert.equal(parseSentenceKey('a::b::x'), null);
  assert.equal(parseSentenceKey('a::b::-1'), null);
  assert.equal(parseSentenceKey('::b::1'), null);
});

check('句子桶：按 课(x句) 生成，占位课(0 句)跳过', () => {
  const lessons = [
    { id: 'l1', count: 3 },
    { id: '', count: 5 },
    { id: 'l2', count: 2 },
  ];
  const keys = [...sentenceKeys(BOOK, lessons)];
  assert.equal(keys.length, 5);
  assert.deepEqual(keys, [
    sentenceKey(BOOK, 'l1', 0),
    sentenceKey(BOOK, 'l1', 1),
    sentenceKey(BOOK, 'l1', 2),
    sentenceKey(BOOK, 'l2', 0),
    sentenceKey(BOOK, 'l2', 1),
  ]);
});

check('书进度：分母是这本书的全部句子', () => {
  const lessons = [{ id: 'l1', count: 4 }];
  const buckets = putStates(emptyBuckets(), [
    { ...emptyItemState(sentenceKey(BOOK, 'l1', 0)), status: 'standby' },
    { ...emptyItemState(sentenceKey(BOOK, 'l1', 1)), status: 'mastered' },
  ]);
  const p = computeProgress(sentenceKeys(BOOK, lessons), (key) => lookupState(buckets, key));
  assert.equal(p.total, 4);
  assert.equal(p.masteredRate, 2 / 4);
  // 没练过的两条不能算进覆盖率
  assert.equal(p.untouched, 2);
  assert.equal(p.coveredRate, 2 / 4);
});

check('真实索引：能按 课|句数|课名 解析并对得上总数', () => {
  const indexDir = 'client/public/listening/_index';
  if (!fs.existsSync(indexDir)) {
    throw new Error(`索引还没生成，先跑 npm run review:index:listening（当前跳不过，它是此脚本的核心校验）`);
  }
  const meta = JSON.parse(fs.readFileSync(`${indexDir}/meta.json`, 'utf8'));
  assert.ok(meta.unitCount > 0 && meta.sentenceCount > 0);

  let books = 0;
  let sentences = 0;
  for (const g of meta.groups) {
    const raw = JSON.parse(fs.readFileSync(`${indexDir}/${g.file}`, 'utf8'));
    for (const [, joined] of Object.entries(raw)) {
      books += 1;
      // 与 review/sentence.ts 的解析保持一致
      const lessons = String(joined ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [id, count] = line.split('|');
          return { id: id ?? '', count: Number(count) || 0 };
        });
      sentences += lessons.reduce((s, l) => s + l.count, 0);
      for (const k of sentenceKeys('placeholder', lessons)) {
        // 生成的键必须能被解回去，否则线上拿到的数据会变成无法还原的孤儿
        assert.ok(parseSentenceKey(k), `解不开的键：${k}`);
      }
    }
  }
  assert.equal(books, meta.unitCount);
  assert.equal(sentences, meta.sentenceCount);
  console.log(`    索引核对：${books} 本 / ${sentences} 句`);
});

check('听写判卷：宽松模式忽略大小写与标点，严格模式不忽略', () => {
  const typed = 'Hello, world!';
  const target = 'hello world';
  assert.equal(judge(typed, target, false).passed, true);
  assert.equal(judge(typed, target, true).passed, false);
  // 漏词 / 多词都要判错，打分不能只看前几个字对不对
  assert.equal(judge('hello', target, false).passed, false);
  assert.equal(judge('hello dear world', target, false).passed, false);
});

check('听写判卷：错位散布的错误能定位到具体哪个词', () => {
  const r = judge('hello wrld', 'hello world', false);
  assert.equal(r.passed, false);
  assert.equal(r.totalWords, 2);
  assert.equal(r.correctCount, 1);
  const mistakes = judgeMistakes(r.diff);
  assert.ok(mistakes, '应当产出 mistakes');
  const values = Object.values(mistakes ?? {}).flat();
  assert.ok(values.includes('wrld'));
  // 全对的句子不该产生 mistakes（出池即丢，也就没什么可记的）
  assert.equal(judgeMistakes(judge('hello world', 'hello world', false).diff), undefined);
});

// ── 英语按天统计（studyStats）────────────────────────────────

check('按天聚合：判错/通过/新句/首对 各口径累加正确', () => {
  const now = new Date('2026-09-27T10:00:00').getTime();
  const day = localDateKey(now);
  let agg = bumpDayAgg(undefined, day, { lessonKey: 'b1::l1', passed: false, isFirstAttemptOfSentence: true }, now);
  agg = bumpDayAgg(agg, day, { lessonKey: 'b1::l1', passed: true, isFirstAttemptOfSentence: false }, now + 1);
  agg = bumpDayAgg(agg, day, { lessonKey: 'b1::l2', passed: true, isFirstAttemptOfSentence: true }, now + 2);
  assert.equal(agg.attempts, 3);
  assert.equal(agg.errors, 1);
  assert.equal(agg.passes, 2);
  assert.equal(agg.newSentences, 2);
  assert.equal(agg.firstPasses, 1); // b1::l1 首次错了，b1::l2 首次就对
  assert.deepEqual(agg.lessons.sort(), ['b1::l1', 'b1::l2']);
  // 日期不匹配时重开新的一天，而不是在旧聚合上累加
  const day2 = localDateKey(now + 86_400_000);
  const next = bumpDayAgg(agg, day2, { lessonKey: 'b1::l1', passed: true, isFirstAttemptOfSentence: false }, now + 86_400_000);
  assert.equal(next.attempts, 1);
  assert.equal(next.date, day2);
});

check('按天日志清理：只保留最近 N 天', () => {
  const now = new Date('2026-09-27T10:00:00').getTime();
  const keys = dayKeysOfLastDays(3, now); // [前天, 昨天, 今天]
  assert.equal(keys.length, 3);
  const log: Record<string, ReturnType<typeof emptyDayAgg>> = {};
  for (const k of keys) log[k] = emptyDayAgg(k, now);
  log['2026-05-01'] = emptyDayAgg('2026-05-01', now); // 太老，应被清掉
  const pruned = pruneDays(log, 90, now);
  assert.equal(Object.keys(pruned).length, 3);
  assert.ok(!('2026-05-01' in pruned));
});

console.log(`\n全部通过：${passed} 项断言\n`);