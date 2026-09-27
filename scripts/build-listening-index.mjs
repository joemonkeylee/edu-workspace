/**
 * 听力单句的复习索引生成器。
 *
 * 跑法：npm run review:index:listening
 *
 * 为什么需要这份索引 —— 复习引擎算进度需要一个「分母」，也就是每个容器里
 * 到底有多少个条目：
 *   书（二级）的分母 = 这本书所有课的句子数之和
 *   系列（一级）的分母 = 该系列所有书的句子数之和
 * 运行时临时去拉几十万个句子不现实，所以离线算好落进静态目录。
 *
 * 两种来源的选择：
 *   方案 A：一本book JSON + 每课一个 lesson JSON（6911 次请求）
 *   方案 B：只抓 book JSON，按 \r\n 切分每课的 text
 * 已抽样验证 18 个样本：切出来的行数 == 课 JSON 里 data.length == 声明的「N句」，
 * 三条口径完全一致，所以走方案 B，下载量从大几十 MB 降到 25MB、请求数 66 个。
 *
 * 产物（public/listening/_index/）：
 *   meta.json    每本书的课数 / 句数 / 所属系列，以及系列分片清单
 *   g<N>.json    系列 -> 书 -> ['<lessonId>|<句数>|<课名>', ...]
 *
 * 注意：占位课（id 为空）也必须占一个位置且句数记 0 —— 路由用的是数组下标，
 * 少一个元素会让后面所有课的序号整体错位。
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'client/public/listening/_index');
const CONSTANTS = path.join(ROOT, 'client/src/english/constants.ts');
const REMOTE = 'http://182.92.129.222/data/lt/books';

const out = (s) => process.stdout.write(s);

/** 从 constants.ts 里抠出 BOOKS 数组，避免为此 import 一个 TS 模块 */
function readBooks() {
  const src = fs.readFileSync(CONSTANTS, 'utf8');
  const start = src.indexOf('export const BOOKS');
  if (start < 0) throw new Error('constants.ts 里找不到 BOOKS');
  // 必须从「= [」之后才开始找收尾的中括号 —— 类型标注里也有一个 `]`（series?: string }[]）
  const arrStart = src.indexOf('= [', start);
  const end = src.indexOf(']', arrStart < 0 ? start : arrStart);
  const body = src.slice(start, end);
  const rows = [...body.matchAll(/\{ id: '([0-9a-f]{32})', name: '([^']+)'(?:[^}]*?)series: '([^']+)'(?:[^}]*?)\}/g)];
  if (rows.length === 0) throw new Error('BOOKS 解析失败，检查 constants.ts 的字段结构');
  return rows.map((m) => ({ id: m[1], name: m[2], series: m[3] }));
}

/** 标题里出现分隔符会打乱后面按行解析的结果，统一抹平 */
const cleanTitle = (s) => String(s ?? '').replace(/[|\r\n]/g, ' ').trim();

async function fetchJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

async function main() {
  const books = readBooks();
  out(`登记书籍          : ${books.length}\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const units = [];
  const failed = [];
  const missingLessons = [];

  // 并发别太高，远端是单台小水管
  const CONCURRENCY = 6;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = cursor;
        cursor += 1;
        if (i >= books.length) return;
        const meta = books[i];
        try {
          const json = await fetchJson(`${REMOTE}/${meta.id}.json`);
          const lessons = Array.isArray(json?.data) ? json.data : [];
          const rows = [];
          let sentences = 0;
          for (const lesson of lessons) {
            // 占位课：没有 id，也没有句子，但必须留在数组里占住下标
            if (!lesson?.id) {
              rows.push(['', 0, cleanTitle(lesson?.title)]);
              continue;
            }
            const lines = String(lesson.text ?? '')
              .split(/\r\n|\r|\n/)
              .map((s) => s.trim())
              .filter(Boolean);
            sentences += lines.length;
            rows.push([String(lesson.id), lines.length, cleanTitle(lesson.title)]);
          }
          units.push({
            id: meta.id,
            name: meta.name,
            group: meta.series,
            lessons: lessons.length,
            sentences,
            rows: rows.map(([id, count, title]) => `${id}|${count}|${title}`).join('\n'),
          });
        } catch (e) {
          failed.push(`${meta.name} (${meta.id}): ${e.message}`);
        }
      }
    }),
  );

  units.sort((a, b) => books.findIndex((x) => x.id === a.id) - books.findIndex((x) => x.id === b.id));

  const groups = new Map();
  for (const u of units) {
    if (!groups.has(u.group)) groups.set(u.group, []);
    groups.get(u.group).push(u);
  }

  // 系列分片：文件名不含中文，避免不同系统下 URL 编码差异
  const groupList = [...groups.entries()].map(([group, list], i) => ({
    group,
    file: `g${i}.json`,
    units: list.length,
    lessons: list.reduce((s, u) => s + u.lessons, 0),
    sentences: list.reduce((s, u) => s + u.sentences, 0),
  }));

  for (const g of groupList) {
    const bucket = {};
    for (const u of groups.get(g.group)) bucket[u.id] = u.rows;
    fs.writeFileSync(path.join(OUT_DIR, g.file), JSON.stringify(bucket));
  }

  const meta = {
    version: 1,
    generatedAt: new Date().toISOString(),
    unitCount: units.length,
    groupCount: groupList.length,
    lessonCount: units.reduce((s, u) => s + u.lessons, 0),
    sentenceCount: units.reduce((s, u) => s + u.sentences, 0),
    units: units.map((u) => ({
      id: u.id,
      name: u.name,
      group: u.group,
      lessons: u.lessons,
      sentences: u.sentences,
    })),
    groups: groupList.map((g) => ({ ...g })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  out(`单元（书）        : ${meta.unitCount}\n`);
  out(`一级分类（系列）  : ${meta.groupCount}\n`);
  out(`课程总数          : ${meta.lessonCount}\n`);
  out(`句子总数（分母）  : ${meta.sentenceCount}\n`);
  out(`最长的一本书      : ${units.reduce((a, b) => (b.sentences > (a?.sentences ?? 0) ? b : a), null)?.name}\n`);
  if (missingLessons.length) out(`无句子的课        : ${missingLessons.length}（占位课，正常）\n`);
  if (failed.length) {
    out(`\n⚠️ 抓取失败 ${failed.length} 本：\n`);
    for (const f of failed) out(`  - ${f}\n`);
  }
  const bytes = fs
    .readdirSync(OUT_DIR)
    .reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0);
  out(`产物体积          : ${(bytes / 1024).toFixed(0)} KB -> ${path.relative(ROOT, OUT_DIR)}\n`);

  // 系列口径提示：一级分类用「并集」去重，而句子天然不重复（带座位号的 key），
  // 所以系列 = 各书求和；单词那边才需要真正的并集去重。
  const top = [...groupList].sort((a, b) => b.sentences - a.sentences).slice(0, 5);
  out('\n句子数最多的系列：\n');
  for (const g of top) out(`  ${g.sentences.toString().padStart(7)} 句  ${g.group}（${g.units} 本）\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
