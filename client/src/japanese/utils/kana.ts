/**
 * 罗马字 ↔ 假名 映射表
 * 自己写的极简版，够五十音用，不引入 wanakana
 */

/** 片假名五十音 base + 浊音 + 半浊音 + 拗音（常用） */
export const KANA_MAP: Record<string, { h: string; k: string }> = {
  // あ行
  a: { h: 'あ', k: 'ア' }, i: { h: 'い', k: 'イ' }, u: { h: 'う', k: 'ウ' },
  e: { h: 'え', k: 'エ' }, o: { h: 'お', k: 'オ' },
  // か行
  ka: { h: 'か', k: 'カ' }, ki: { h: 'き', k: 'キ' }, ku: { h: 'く', k: 'ク' },
  ke: { h: 'け', k: 'ケ' }, ko: { h: 'こ', k: 'コ' },
  // さ行
  sa: { h: 'さ', k: 'サ' }, shi: { h: 'し', k: 'シ' }, si: { h: 'し', k: 'シ' },
  su: { h: 'す', k: 'ス' }, se: { h: 'せ', k: 'セ' }, so: { h: 'そ', k: 'ソ' },
  // た行
  ta: { h: 'た', k: 'タ' }, chi: { h: 'ち', k: 'チ' }, ti: { h: 'ち', k: 'チ' },
  tsu: { h: 'つ', k: 'ツ' }, tu: { h: 'つ', k: 'ツ' }, te: { h: 'て', k: 'テ' },
  to: { h: 'と', k: 'ト' },
  // な行
  na: { h: 'な', k: 'ナ' }, ni: { h: 'に', k: 'ニ' }, nu: { h: 'ぬ', k: 'ヌ' },
  ne: { h: 'ね', k: 'ネ' }, no: { h: 'の', k: 'ノ' },
  // は行
  ha: { h: 'は', k: 'ハ' }, hi: { h: 'ひ', k: 'ヒ' }, hu: { h: 'ふ', k: 'フ' },
  fu: { h: 'ふ', k: 'フ' }, he: { h: 'へ', k: 'ヘ' }, ho: { h: 'ほ', k: 'ホ' },
  // ま行
  ma: { h: 'ま', k: 'マ' }, mi: { h: 'み', k: 'ミ' }, mu: { h: 'む', k: 'ム' },
  me: { h: 'め', k: 'メ' }, mo: { h: 'も', k: 'モ' },
  // や行
  ya: { h: 'や', k: 'ヤ' }, yu: { h: 'ゆ', k: 'ユ' }, yo: { h: 'よ', k: 'ヨ' },
  // ら行
  ra: { h: 'ら', k: 'ラ' }, ri: { h: 'り', k: 'リ' }, ru: { h: 'る', k: 'ル' },
  re: { h: 'れ', k: 'レ' }, ro: { h: 'ろ', k: 'ロ' },
  // わ行
  wa: { h: 'わ', k: 'ワ' }, wo: { h: 'を', k: 'ヲ' },
  // 拨音
  n: { h: 'ん', k: 'ン' }, nn: { h: 'ん', k: 'ン' },
};

/** 浊音 */
export const DAKUON: Record<string, { h: string; k: string }> = {
  ga: { h: 'が', k: 'ガ' }, gi: { h: 'ぎ', k: 'ギ' }, gu: { h: 'ぐ', k: 'グ' },
  ge: { h: 'げ', k: 'ゲ' }, go: { h: 'ご', k: 'ゴ' },
  za: { h: 'ざ', k: 'ザ' }, ji: { h: 'じ', k: 'ジ' }, zi: { h: 'じ', k: 'ジ' },
  zu: { h: 'ず', k: 'ズ' }, ze: { h: 'ぜ', k: 'ゼ' }, zo: { h: 'ぞ', k: 'ゾ' },
  da: { h: 'だ', k: 'ダ' }, di: { h: 'ぢ', k: 'ヂ' }, du: { h: 'づ', k: 'ヅ' },
  de: { h: 'で', k: 'デ' }, do: { h: 'ど', k: 'ド' },
  ba: { h: 'ば', k: 'バ' }, bi: { h: 'び', k: 'ビ' }, bu: { h: 'ぶ', k: 'ブ' },
  be: { h: 'べ', k: 'ベ' }, bo: { h: 'ぼ', k: 'ボ' },
};

/** 半浊音 */
export const HANDAKUON: Record<string, { h: string; k: string }> = {
  pa: { h: 'ぱ', k: 'パ' }, pi: { h: 'ぴ', k: 'ピ' }, pu: { h: 'ぷ', k: 'プ' },
  pe: { h: 'ぺ', k: 'ペ' }, po: { h: 'ぽ', k: 'ポ' },
};

/** 小文字（促音・拗音） */
export const SMALL: Record<string, string> = {
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ', ltu: 'っ', ltsu: 'っ',
  xtu: 'っ', xtsu: 'っ',
};

const ALL = { ...KANA_MAP, ...DAKUON, ...HANDAKUON };

/** 罗马字 → 假名（匹配最长前缀） */
export function romajiToKana(input: string): string {
  const lower = input.toLowerCase().trim();
  let result = '';
  let i = 0;
  while (i < lower.length) {
    let matched = false;
    // 先尝试 3 字符
    for (let len = 3; len >= 1; len--) {
      if (i + len > lower.length) continue;
      const chunk = lower.slice(i, i + len);
      if (ALL[chunk]) { result += ALL[chunk].h; i += len; matched = true; break; }
      if (SMALL[chunk]) { result += SMALL[chunk]; i += len; matched = true; break; }
    }
    if (!matched) { result += lower[i]; i++; }
  }
  return result;
}

/** 生成错误选项（从同一 group 或相近 group 选） */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 生成 4 个选项（含正确答案） */
export function generateOptions<T>(correct: T, pool: T[], count = 4): T[] {
  const others = pool.filter((x) => x !== correct);
  const shuffled = shuffle(others);
  const picks = shuffled.slice(0, Math.min(count - 1, shuffled.length));
  return shuffle([correct, ...picks]);
}
