#!/usr/bin/env node
/**
 * 书籍清理结果校验（与 books-bulk-delete.mjs 配套）
 *
 * 用法（在仓库根目录执行）：
 *   node scripts/books-verify.mjs [--keep=legacy|assignments] [--also-keep=<分类名,...>]
 *                                 [--also-keep-like=<子串,...>]
 *
 * 保留口径必须与 books-bulk-delete.mjs 保持一致：
 *   legacy      : title/category 含「必刷题」OR category 含「教材」OR id 在 EXTRA_KEEP
 *   assignments : 以 assignment 表反推（默认）—— 作业挂在哪些书就只留哪些
 * --also-keep    : 额外并入保留口径的分类（精确名，用于「清理后又手动 restore 某分类」的场景）
 * --also-keep-like : 同上，但按子串匹配分类名（如 --also-keep-like=教材 覆盖其全部变体）
 *
 * 所有期望值都由当前口径动态推导，不写死数字；全库总行数是唯一硬约束（防止物理删除误跑）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT_DIR, 'server', '.env') });

const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient();
const q = (s) => p.$queryRawUnsafe(s);

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  return args.includes(`--${name}`) ? true : def;
};
const KEEP_MODE = String(getArg('keep', 'assignments'));
const EXPECT_TOTAL = Number(getArg('expect-total', 14665)) || 14665; // 全库行数，物理清除后会变，故可覆盖
const EXPECT_STROKES = Number(getArg('expect-strokes', 7148)) || 7148;

// storage 根：与 server/src/services/storage.ts 一致（appsetting 覆盖 > .env）
async function resolveStorageRoot() {
  const s = await p.appSetting.findUnique({ where: { key: 'storageRoot' } });
  if (s?.value) return path.resolve(s.value);
  return path.resolve(ROOT_DIR, 'server', process.env.STORAGE_DIR || './storage');
}

let KEEP_SQL;
let keepIdsFromAssignments = null;
if (KEEP_MODE === 'assignments') {
  const rows = await q('SELECT DISTINCT bookId FROM assignment');
  keepIdsFromAssignments = [...new Set(rows.map((r) => Number(r.bookId)).filter((n) => n > 0))];
  if (keepIdsFromAssignments.length === 0) {
    console.error('assignment 表为空，无法以作业反推保留集合。请用 --keep=legacy 或先确认作业数据。');
    process.exit(1);
  }
  KEEP_SQL = `id IN (${keepIdsFromAssignments.join(',')})`;
} else if (KEEP_MODE === 'legacy') {
  KEEP_SQL = `(title LIKE '%必刷题%' OR category LIKE '%必刷题%' OR category LIKE '%教材%' OR id IN (14630))`;
} else {
  console.error(`未知 --keep=${KEEP_MODE}（应为 legacy | assignments）`);
  process.exit(1);
}

// --also-keep=<分类名>[,<分类名>]：把额外分类并入保留口径。
// 用途：清理后又手动还原了某个分类（例如 --mode=restore --category=2025必刷题），
// 让校验仍能以「清理结果 + 手动捞回」为期望，而不是报一堆"越界"。
const alsoKeepCats = String(getArg('also-keep', ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (alsoKeepCats.length) {
  const list = alsoKeepCats.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
  KEEP_SQL = `(${KEEP_SQL} OR category IN (${list}))`;
}

// --also-keep-like=<子串>：同上，但按 LIKE 匹配分类名（分类变体多时比逐个列举稳）。
const alsoKeepLike = String(getArg('also-keep-like', ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (alsoKeepLike.length) {
  const conds = alsoKeepLike
    .map((c) => `category LIKE '%${c.replace(/[\\'%_]/g, (m) => '\\' + m)}%'`)
    .join(' OR ');
  KEEP_SQL = `(${KEEP_SQL} OR ${conds})`;
}

const ROOT = await resolveStorageRoot();
const BOOKS = path.join(ROOT, 'books');
const DELETED = path.join(ROOT, 'books-deleted');

const fail = [];
const ok = (cond, msg) => { console.log((cond ? '  [OK]   ' : '  [FAIL] ') + msg); if (!cond) fail.push(msg); };

console.log(`storage 根: ${ROOT}`);
console.log(`保留口径  : ${KEEP_MODE}${keepIdsFromAssignments ? `（作业反推 ${keepIdsFromAssignments.length} 个 bookId）` : ''}\n`);

console.log('================ 数据库 ================');
const total = Number((await q('SELECT COUNT(*) c FROM book'))[0].c);
const aliveRows = await q('SELECT id,title,category FROM book WHERE isDeleted=0 ORDER BY id');
const dead = Number((await q('SELECT COUNT(*) c FROM book WHERE isDeleted=1'))[0].c);
const keepRows = await q(`SELECT id FROM book WHERE ${KEEP_SQL}`);
const keepIds = keepRows.map((r) => Number(r.id));
const keepSet = new Set(keepIds);

console.log(`  全库 ${total} | 可见 ${aliveRows.length} | 已软删 ${dead} | 保留口径 ${keepIds.length}`);
ok(total === EXPECT_TOTAL, `全库行数 = ${EXPECT_TOTAL}（实际 ${total}，值为 0 表示已物理清除）`);
ok(aliveRows.length === keepIds.length, `前台可见书数 = 保留口径大小 ${keepIds.length}（实际 ${aliveRows.length}）`);

const leaked = aliveRows.filter((b) => !keepSet.has(Number(b.id)));
ok(leaked.length === 0, `可见书中无越界项（实际 ${leaked.length}）`);
if (leaked.length) for (const l of leaked.slice(0, 10)) console.log('       越界: [' + l.id + '] ' + l.title);

const missed = keepIds.filter((id) => !aliveRows.some((b) => Number(b.id) === id));
ok(missed.length === 0, `保留口径内的书全部可见（被误标 ${missed.length}）`);
if (missed.length) console.log('       被误标: ' + missed.slice(0, 20).join(','));

console.log('\n================ 作业与笔迹 ================');
const asg = await q(`SELECT a.bookId, b.title, b.isDeleted, COUNT(*) c FROM assignment a JOIN book b ON b.id=a.bookId GROUP BY a.bookId, b.title, b.isDeleted`);
console.log('  作业归属:');
for (const a of asg) console.log(`    book=${a.bookId} "${a.title}" isDeleted=${a.isDeleted} -> ${a.c} 份`);
ok(asg.every((a) => !a.isDeleted), '所有挂有作业的书都未被软删');

const totalAsg = Number((await q('SELECT COUNT(*) c FROM assignment'))[0].c);
const strokes = Number((await q('SELECT COUNT(*) c FROM assignmentstroke'))[0].c);
console.log(`  作业 ${totalAsg} 份 | 笔迹 ${strokes} 条`);
ok(strokes === EXPECT_STROKES, `笔迹总数 = ${EXPECT_STROKES}（实际 ${strokes}）`);

console.log('\n================ 文件系统 ================');
const booksDirs = fs.readdirSync(BOOKS).filter((n) => /^\d+$/.test(n)).map(Number);
const delDirs = fs.readdirSync(DELETED).filter((n) => /^\d+$/.test(n)).map(Number);
const expectDel = total === 0 ? delDirs.length : total - keepIds.length;
console.log(`  books/ = ${booksDirs.length} 个目录 | books-deleted/ = ${delDirs.length} 个目录`);
ok(booksDirs.length === keepIds.length, `books/ 下恰好 ${keepIds.length} 个目录（实际 ${booksDirs.length}）`);
ok(delDirs.length === expectDel, `books-deleted/ 下恰好 ${expectDel} 个目录（实际 ${delDirs.length}）`);

const keepMissing = keepIds.filter((id) => !fs.existsSync(path.join(BOOKS, String(id))));
ok(keepMissing.length === 0, `${keepIds.length} 本保留书的资源目录全部在位（缺 ${keepMissing.length}）`);
if (keepMissing.length) console.log('       缺: ' + keepMissing.join(','));

const keepHasContent = keepIds.filter((id) => {
  const d = path.join(BOOKS, String(id));
  if (!fs.existsSync(d)) return false;
  return fs.readdirSync(d).some((n) => /^\d+$/.test(n) || n.toLowerCase().endsWith('.pdf'));
});
ok(keepHasContent.length === keepIds.length, `${keepIds.length} 本保留书目录内均有页图/PDF（实际 ${keepHasContent.length}）`);

// 交叉核对：库 × 文件系统 双向
const delSet = new Set(delDirs);
const dbDeadIds = (await q('SELECT id FROM book WHERE isDeleted=1')).map((r) => Number(r.id));
const mismatch = dbDeadIds.filter((id) => !delSet.has(id));
ok(mismatch.length === 0, `库中已软删的书都有对应的 books-deleted 目录（不匹配 ${mismatch.length}）`);
if (mismatch.length) console.log('       不匹配: ' + mismatch.slice(0, 20).join(','));

const booksSet = new Set(booksDirs);
const noDir = aliveRows.filter((b) => !booksSet.has(Number(b.id)));
ok(noDir.length === 0, `库中可见的书都有对应的 books/ 目录（缺 ${noDir.length}）`);
if (noDir.length) console.log('       缺: ' + noDir.slice(0, 20).map((b) => b.id).join(','));

console.log('\n================ 保留清单 ================');
for (const b of aliveRows) console.log(`  [${b.id}] ${b.title} | ${b.category}`);

console.log('\n================ 结论 ================');
console.log(fail.length === 0 ? '  全部校验通过 ✓' : `  ${fail.length} 项未通过：\n    - ` + fail.join('\n    - '));
await p.$disconnect();
process.exit(fail.length === 0 ? 0 : 1);
