#!/usr/bin/env node
/**
 * 生成单词模块的「去重词表索引」，供掌握度进度计算使用。
 *
 * 为什么需要它：
 * - 原始词库存在大量重复：全书 367,061 条去重后只有 42,353 个不同的词（重复率 8.7 倍）；
 * - 同一本词库内部也有重复词条（如 Categorized_TOEFL 4,123 → 3,669）；
 * - 计算「书进度」必须以去重后的词数为分母，否则某本书永远刷不到 100%；
 * - 计算「一级分类进度」需要该分类下所有书的词表并集，运行时不可能临时拉 59 个 JSON。
 *
 * 产物：
 *   client/public/dicts/_index/meta.json   每个 unit(书) 的 raw/unique 词数与所属 group(一级分类)
 *   client/public/dicts/_index/g<N>.json   group -> unitId -> 去重词串（\n 分隔）
 *
 * 用法：node scripts/build-review-index.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dictsDir = path.join(root, 'client/public/dicts');
const outDir = path.join(dictsDir, '_index');
const dictSource = fs.readFileSync(path.join(root, 'client/src/typing/dictionaries.ts'), 'utf8');

/** 与 review/engine.ts 的 normalizeItemKey 保持一致 */
function normalizeKey(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

function parseDicts() {
  const out = [];
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)'[\s\S]*?category:\s*'([^']+)'[\s\S]*?url:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(dictSource)) !== null) {
    out.push({ id: m[1], name: m[2], group: m[3], url: m[4] });
  }
  return out;
}

const dicts = parseDicts();
if (dicts.length === 0) {
  console.error('未能从 dictionaries.ts 解析出词库清单，检查正则是否仍匹配');
  process.exit(1);
}

/** group -> unitId -> string[] */
const groups = new Map();
const units = [];
let totalRaw = 0;
let totalUnique = 0;
const missing = [];
/** 跨所有 unit 的全局并集，仅作参考输出：真正的分母用「书内去重」或「分类并集」 */
const globalUnionAll = new Set();

for (const d of dicts) {
  const file = path.join(dictsDir, d.url.replace(/^\/dicts\//, ''));
  if (!fs.existsSync(file)) {
    missing.push(`${d.id} -> ${d.url}`);
    continue;
  }
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Set();
  const words = [];
  for (const w of list) {
    const key = normalizeKey(w?.name);
    if (!key) continue;
    globalUnionAll.add(key);
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(key);
  }
  totalRaw += list.length;
  totalUnique += words.length;
  units.push({ id: d.id, group: d.group, raw: list.length, unique: words.length });
  if (!groups.has(d.group)) groups.set(d.group, new Map());
  groups.get(d.group).set(d.id, words);
}

fs.mkdirSync(outDir, { recursive: true });

// group 名是中文，文件名用索引避免 URL 编码问题；映射关系写进 meta.json
const globalUniqueSize = globalUnionAll.size;

const groupOrder = [...groups.keys()];
const groupFiles = {};
const groupMeta = [];

groupOrder.forEach((group, i) => {
  const fname = `g${i}.json`;
  groupFiles[group] = fname;
  const bucket = groups.get(group);

  const payload = {};
  const globalUnion = new Set();
  for (const [unitId, words] of bucket) {
    for (const w of words) globalUnion.add(w);
    payload[unitId] = words.join('\n');
  }

  const groupUnique = globalUnion.size;
  let groupRaw = 0;
  for (const u of units) if (u.group === group) groupRaw += u.raw;

  fs.writeFileSync(path.join(outDir, fname), JSON.stringify(payload));
  groupMeta.push({
    group,
    file: fname,
    units: bucket.size,
    raw: groupRaw,
    unique: groupUnique,
  });
});

fs.writeFileSync(
  path.join(outDir, 'meta.json'),
  JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), unitCount: units.length, units, groups: groupMeta }),
);

const bytes = (p) => fs.statSync(path.join(outDir, p)).size;
let indexBytes = 0;
for (const g of groupMeta) indexBytes += bytes(g.file);

console.log('unit 数量            :', units.length);
console.log('原始词条 / 书内去重后:', totalRaw, '/', totalUnique, `（书内重复 ${totalRaw - totalUnique} 条）`);
console.log('跨书全局并集(参考)   :', globalUniqueSize, '← 分母永远按 书内去重 或 分类并集 算，不能用这个');
console.log('一级分类           :', groupOrder.length);
for (const g of groupMeta.sort((a, b) => b.unique - a.unique)) {
  console.log(`  ${g.group.padEnd(6)} ${String(g.units).padStart(3)} 本  raw ${String(g.raw).padStart(7)}  并集 ${String(g.unique).padStart(6)}`);
}
console.log('索引体积合计       :', (indexBytes / 1024 / 1024).toFixed(2), 'MB');
if (missing.length) console.log('缺失的词库文件     :', missing.slice(0, 10));
