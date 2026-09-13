/**
 * 导入 PDF 时清理文件名里的广告 / 水印噪声。
 *
 * 典型噪声：
 *   【爱豆爱做题】、【一手资源更新有保障联系sanniaowl】、加微信xxx、QQ群123456、
 *   -17512345678（10 位时间戳）、（无水印）
 *
 * 只删噪声，不动讲次、课型等真实信息 —— 清洗后的名字是要给用户看的书名。
 */

/** 括号里出现这些词，整段括号连同内容一起删掉 */
const BRACKET_NOISE = [
  '爱豆',
  '一手资源',
  '一手',
  '资源更新',
  '有保障',
  '联系',
  '微信',
  'qq',
  'vx',
  '公众号',
  '网盘',
  '水印',
  '免费领',
  '领取',
  '获取更多',
  '加微',
  '客服',
  '咨询',
  'sanniaowl',
];

/** 不需要括号、见到就删的广告片段（按长到短，避免短的先吃掉长的） */
const BARE_NOISE: RegExp[] = [
  // 微信转发 / 导出的文件名前缀：wx_11250808609112-、mmexport1234567890
  /(?:^|[-_\s])(?:wx|WX|mmexport)[_\-]?\d{6,}\s*[-—–_]*/gi,
  /一手资源[^。]*?(?:联系|微信|qq|vx)?\s*[a-z0-9_-]{4,}/gi, // 一手资源更新有保障联系sanniaowl
  /一手资源[^。]*/g,
  /一手课程[^。]*/g,
  /(?:加|联系)?\s*微\s*信\s*[:：]?\s*[a-z0-9_-]{4,}/gi,
  /(?:加|联系)?\s*[vV][xX]\s*[:：]?\s*[a-z0-9_-]{4,}/g,
  /(?:QQ|qq|Q群|QQ群|q群)\s*[:：]?\s*\d{5,}/g,
  /(?:电话|手机|手机微信|微信同号)\s*[:：]?\s*\d{6,}/g,
  /\b\d{8,}\b/g, // 8 位以上数字串：时间戳 / 长 ID
  // 裸后缀（不带括号）：-无水印 / -sanniaowl / +V：sanniaowl
  /[-\s_+]*[vV]\s*[:：]\s*[a-z0-9_-]{3,}/gi,
  /[-\s_]*sanniaowl\b/gi,
  /[-\s_]*无水印/g,
  // 教辅品牌名，出现在书名里属于噪声：初二A+爱豆爱做题 → 初二A+
  /爱豆爱做题/g,
  /爱豆习题/g,
];

/** 括号对：开 → 闭 */
const BRACKETS: Array<[string, string]> = [
  ['【', '】'],
  ['《', '》'],
  ['（', '）'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
];

/** 出现任一噪声词，或含 6 位以上连续数字（QQ / 时间戳） */
function isNoiseBracket(inner: string): boolean {
  const lower = inner.toLowerCase();
  if (BRACKET_NOISE.some((k) => lower.includes(k.toLowerCase()))) return true;
  if (/\d{6,}/.test(inner)) return true;
  // 纯符号 / 空
  return inner.trim().length === 0;
}

/**
 * 删掉内容含噪声的括号段。
 * 开闭括号允许混用（真实文件名里常见「（一手课程+V：sanniaowl)」这种半截括号），
 * 所以不按固定配对，而是「任意开括号 → 任意闭括号」。
 */
const OPEN_CHARS = '（(【[{《';
const CLOSE_CHARS = '）)】]}》';
const MIXED_BRACKET_RE = new RegExp(
  `[${OPEN_CHARS.replace(/[[\]\\]/g, '\\$&')}]` +
    `[^${OPEN_CHARS.replace(/[[\]\\]/g, '\\$&')}${CLOSE_CHARS.replace(/[[\]\\]/g, '\\$&')}]*` +
    `[${CLOSE_CHARS.replace(/[[\]\\]/g, '\\$&')}]`,
  'g',
);

function stripNoiseBrackets(s: string): string {
  return s.replace(MIXED_BRACKET_RE, (m) => {
    const inner = m.slice(1, -1);
    return isNoiseBracket(inner) ? '' : m;
  });
}

/** 收尾清理：空括号、连续分隔符、首尾残留 */
function tidy(s: string): string {
  let out = s;
  // 空括号（可能嵌套删除后剩下）
  for (const [open, close] of BRACKETS) {
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`${esc(open)}\\s*${esc(close)}`, 'g'), '');
  }
  // 全角/不间断空格 → 普通空格
  out = out.replace(/[\u3000\u00a0]/g, ' ');
  // 首尾的分隔符、下划线、点
  out = out.replace(/^[\s\-_—–.、,，]+/, '').replace(/[\s\-_—–.、,，]+$/, '');
  // 多个空格 / 多个连字符
  out = out.replace(/\s{2,}/g, ' ').replace(/-{2,}/g, '-');
  return out.trim();
}

/**
 * 清洗 PDF 文件名。
 * @returns title 清洗后的书名（不含扩展名）、fileName 清洗后的文件名、changed 是否发生变化
 */
export function cleanPdfName(fileName: string): { title: string; fileName: string; changed: boolean } {
  // 「正文.pdf.pdf」这类重复扩展名先折叠，否则书名里会残留一个 .pdf
  const name = fileName.replace(/(\.[A-Za-z0-9]{1,5})\1+$/i, '$1');
  const extMatch = name.match(/(\.[A-Za-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : '';
  const base = ext ? name.slice(0, -ext.length) : name;

  let s = base;
  s = stripNoiseBrackets(s);
  for (const re of BARE_NOISE) s = s.replace(re, '');
  s = tidy(s);

  // 清洗后为空（整名都是广告）→ 回退原名，避免书名丢失
  const title = s || tidy(base) || base;
  const cleanFileName = `${title}${ext}`;
  return { title, fileName: cleanFileName, changed: cleanFileName !== fileName };
}

/** 文件名非法字符兜底（Windows） */
export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_');
}
