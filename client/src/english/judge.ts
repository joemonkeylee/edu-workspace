/**
 * 听力单句的判卷逻辑。
 *
 * 从 TypePanel 里抽出来是为了让「主线练习」和「错句复习 / 抽查」共用同一套标准：
 * 两个练习面分数算法不一致的话，同一个句子会出现「主练习算对、复习算错」的鬼故事。
 *
 * 判的是「听写出来的词序列」和「原句的词序列」之间的最长公共子序列 —— 允许打岔、
 * 允许漏词补词，比逐字符比对更贴近听写的真实手感。
 */

export interface WordDiff {
  expected: string;
  typed?: string;
  status: 'correct' | 'wrong' | 'missing' | 'extra';
}

export interface JudgeResult {
  passed: boolean;
  correctCount: number;
  totalWords: number;
  diff: WordDiff[];
}

export interface Token {
  raw: string;
  norm: string;
}

/** strict=false 时忽略大小写与中英文标点，只比词本身 */
export function normalizeToken(token: string, strict: boolean): string {
  if (strict) return token;
  return token.toLowerCase().replace(/[.,!?;:'"""''(){}[\]…—–·-]/g, '');
}

export function toTokens(text: string, strict: boolean): Token[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: normalizeToken(raw, strict) }))
    .filter((t) => t.norm.length > 0);
}

/** LCS 对齐，标出每个位置是命中 / 多打 / 漏打 */
export function diffTokens(typed: Token[], expected: Token[]): WordDiff[] {
  const n = typed.length;
  const m = expected.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        typed[i].norm === expected[j].norm
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: WordDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (typed[i].norm === expected[j].norm) {
      result.push({ expected: expected[j].raw, typed: typed[i].raw, status: 'correct' });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ expected: '', typed: typed[i].raw, status: 'extra' });
      i += 1;
    } else {
      result.push({ expected: expected[j].raw, status: 'missing' });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ expected: '', typed: typed[i].raw, status: 'extra' });
    i += 1;
  }
  while (j < m) {
    result.push({ expected: expected[j].raw, status: 'missing' });
    j += 1;
  }
  return result;
}

/** 「多打一个 + 漏打一个」相邻时合并成一条 wrong，展示上更像人改的 */
export function mergeWrong(diff: WordDiff[]): WordDiff[] {
  const result: WordDiff[] = [];
  let i = 0;
  while (i < diff.length) {
    const cur = diff[i];
    const next = diff[i + 1];
    if (cur.status === 'extra' && next?.status === 'missing') {
      result.push({ expected: next.expected, typed: cur.typed, status: 'wrong' });
      i += 2;
      continue;
    }
    if (cur.status === 'missing' && next?.status === 'extra') {
      result.push({ expected: cur.expected, typed: next.typed, status: 'wrong' });
      i += 2;
      continue;
    }
    result.push(cur);
    i += 1;
  }
  return result;
}

export function judge(typedText: string, targetText: string, strict: boolean): JudgeResult {
  const typedTokens = toTokens(typedText, strict);
  const expectedTokens = toTokens(targetText, strict);
  const diff = mergeWrong(diffTokens(typedTokens, expectedTokens));
  return {
    passed: diff.every((d) => d.status === 'correct'),
    correctCount: diff.filter((d) => d.status === 'correct').length,
    totalWords: expectedTokens.length,
    diff,
  };
}

/**
 * 把判卷结果压成复习引擎用的 mistakes：{ [词下标]: [打错的词] }。
 * 只在答错时写，出池即丢；最多记 12 处，够回溯又不会把 localStorage 撑爆。
 */
export function judgeMistakes(diff: WordDiff[]): Record<number, string[]> | undefined {
  let index = 0;
  const out: Record<number, string[]> = {};
  for (const d of diff) {
    index += 1;
    if (d.status === 'correct') continue;
    out[index - 1] = [d.typed ?? '', d.expected].filter(Boolean).slice(0, 3);
    if (Object.keys(out).length >= 12) break;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
