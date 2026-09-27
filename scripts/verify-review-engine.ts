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

console.log(`\n全部通过：${passed} 项断言\n`);
