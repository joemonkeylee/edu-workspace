/**
 * 短雪花 id 生成器（base62 编码的 63-bit 雪花）。
 *
 * 布局（高位 → 低位）：
 *   timestamp(41bit) | node(10bit) | sequence(12bit)
 *
 * 自定义 epoch 选在 2023-11，使 41-bit 时间戳在未来几十年内都不会溢出；
 * 整体再经 base62 编码，得到约 11 字符的可读短串（适合放进 URL / 主键）。
 *
 * 与现有 pdf_book 的 Int 自增主键不同，专栏模块统一用这种 String 短 id，
 * 便于对外暴露、避免暴露自增序号，也能跨服务保持唯一（node 由 env 区分）。
 */

const EPOCH = 1_700_000_000_000; // 2023-11-14T22:13:20Z

const NODE_ID = ((): number => {
  const fromEnv = parseInt(process.env.SHORT_ID_NODE ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv >= 0 && fromEnv <= 0x3ff) return fromEnv;
  return 1;
})();

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function toBase62(n: bigint): string {
  if (n === 0n) return '0';
  let s = '';
  while (n > 0n) {
    s = B62[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s;
}

let lastTs = 0;
let seq = 0;

/** 生成一个全局唯一的短雪花 id（base62 字符串） */
export function nextShortId(): string {
  let ts = Date.now() - EPOCH;
  if (ts < 0) ts = 0;

  if (ts === lastTs) {
    seq = (seq + 1) & 0xfff;
  } else {
    lastTs = ts;
    seq = 0;
  }

  const id = (BigInt(ts) << 22n) | (BigInt(NODE_ID) << 12n) | BigInt(seq);
  return toBase62(id);
}

export const SHORT_ID_NODE = NODE_ID;
