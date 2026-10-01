#!/usr/bin/env node
/**
 * 书籍批量软删 / 物理清除工具
 *
 * 用法（在仓库根目录执行）：
 *   node scripts/books-bulk-delete.mjs --mode=soft  [--dry-run] [--limit=N]
 *   node scripts/books-bulk-delete.mjs --mode=purge [--dry-run] [--limit=N]
 *   node scripts/books-bulk-delete.mjs --mode=restore --ids=14638,14639 --yes
 *   node scripts/books-bulk-delete.mjs --mode=restore --ids=all --yes
 *   node scripts/books-bulk-delete.mjs --mode=restore --category=2025必刷题 --yes
 *   node scripts/books-bulk-delete.mjs --mode=restore --category-like=教材 --yes
 *
 *   soft    : storage/books/{id} → storage/books-deleted/{id}，并把 book.isDeleted 置 1
 *   purge   : 物理删除 books-deleted/{id} 与 crops/{id}，并 DELETE book 行（外键级联清理关联表）
 *   restore : 反向还原 —— books-deleted/{id} → books/{id}，并把 book.isDeleted 归 0
 *             范围用 --ids=<id列表> / --ids=all / --category=<精确分类名> / --category-like=<子串> 指定
 *             （只作用于已软删的；目录还原有失败时跳过 DB 更新，保证库与文件一致）
 *
 * 保留口径（改这里）：--keep=legacy（默认）| assignments
 *   legacy      : title 或 category 含「必刷题」 OR category 含「教材」 OR id 在 EXTRA_KEEP
 *   assignments : 以 assignment 表反推 —— 作业挂在哪些书，就只留哪些书（最严格）
 *                 若 assignment 为空则会直接中断，避免误清空全库
 *
 * 删除前的检查：会打印待删/保留数量、抽样条目，并要求 --yes 才真正执行。
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, 'server', '.env') });

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

// ── 保留口径 ────────────────────────────────────────────────────────
const EXTRA_KEEP = [14630]; // 仅 legacy 口径使用：挂有作业的课程书
const LEGACY_KEEP_SQL = `(title LIKE '%必刷题%' OR category LIKE '%必刷题%' OR category LIKE '%教材%' OR category LIKE '%笔记%' OR id IN (${EXTRA_KEEP.join(',')}))`;

// ── 参数 ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  return args.includes(`--${name}`) ? true : def;
};
const MODE = getArg('mode', 'soft');
const DRY = Boolean(getArg('dry-run', false));
const YES = Boolean(getArg('yes', false));
const NO_BACKUP = Boolean(getArg('no-backup', false));
const LIMIT = Number(getArg('limit', 0)) || 0;
const CONCURRENCY = Number(getArg('concurrency', 16)) || 16;
const KEEP_MODE = String(getArg('keep', 'legacy'));
const KEEP_IDS = String(getArg('keep-ids', ''))
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

if (!['soft', 'purge', 'restore'].includes(MODE)) {
  console.error(`未知 mode: ${MODE}（应为 soft | purge | restore）`);
  process.exit(1);
}

// ── storage 根：与 server/src/services/storage.ts 一致（appsetting 覆盖 > .env）──
async function resolveStorageRoot() {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'storageRoot' } });
  if (setting?.value) return path.resolve(setting.value);
  return path.resolve(ROOT, 'server', process.env.STORAGE_DIR || './storage');
}

const STORAGE_ROOT = await resolveStorageRoot();
const BOOKS = path.join(STORAGE_ROOT, 'books');
const DELETED = path.join(STORAGE_ROOT, 'books-deleted');
const CROPS = path.join(STORAGE_ROOT, 'crops');
const BACKUP_DIR = path.join(STORAGE_ROOT, 'db-backups');

// ── 保留集合解析 ────────────────────────────────────────────────────
/** 返回 { sql, ids, source }；ids 仅在 assignments 口径下有值（legacy 为 null） */
async function resolveKeep() {
  if (KEEP_MODE === 'assignments') {
    const rows = await prisma.$queryRawUnsafe('SELECT DISTINCT bookId FROM assignment');
    const ids = [...new Set(rows.map((r) => Number(r.bookId)).filter((n) => Number.isFinite(n) && n > 0))];
    if (ids.length === 0) {
      throw new Error('assignment 表为空：按作业反推的保留集合为空。已中断，未做任何改动。');
    }
    return { sql: `id IN (${ids.join(',')})`, ids, source: 'assignment' };
  }
  if (KEEP_MODE === 'legacy') {
    return { sql: LEGACY_KEEP_SQL, ids: null, source: 'legacy' };
  }
  throw new Error(`未知 --keep=${KEEP_MODE}（应为 legacy | assignments）`);
}

console.log('storage 根目录 :', STORAGE_ROOT);
console.log('模式           :', MODE, DRY ? '(DRY-RUN 不落盘)' : '');
console.log('保留口径       :', KEEP_MODE);
console.log('');

async function computeSets(KEEP) {
  const keep = await prisma.$queryRawUnsafe(`SELECT id FROM book WHERE ${KEEP.sql}`);
  const all = await prisma.$queryRawUnsafe(`SELECT id, isDeleted FROM book`);
  const keepSet = new Set(keep.map((r) => Number(r.id)));
  const allIds = all.map((r) => Number(r.id));
  const nonKeep = allIds.filter((id) => !keepSet.has(id));

  // 以文件系统为准：仍在 books/ 下的才需要移动。
  // 这样即使 DB 已被标记、但文件因故未移动（或反之），重跑都能自愈。
  const moveIds = nonKeep.filter((id) => fs.existsSync(path.join(BOOKS, String(id))));
  // DB 标记：幂等，nonKeep 全量重标一遍
  const markIds = nonKeep;

  const alreadyDeleted = all.filter((r) => r.isDeleted).map((r) => Number(r.id)).length;
  const totalPending = moveIds.length;
  let limited = moveIds;
  if (LIMIT > 0) limited = moveIds.slice(0, LIMIT);
  return { keepSet, allIds, delIds: limited, moveIds, markIds, alreadyDeleted, totalPending };
}

/** 简易并发池 */
async function pool(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { ok: true, value: await worker(items[i]) };
      } catch (e) {
        results[i] = { ok: false, error: e?.message || String(e), item: items[i] };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

// ── 备份：把待删书及其关联行导出 JSON ────────────────────────────────
async function backup(delIds) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `books-delete-backup-${ts}.json`);

  const chunkSize = 2000;
  const bookRows = [];
  for (let i = 0; i < delIds.length; i += chunkSize) {
    const chunk = delIds.slice(i, i + chunkSize);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM book WHERE id IN (${chunk.join(',')})`,
    );
    bookRows.push(...rows);
  }

  const related = {};
  const queries = {
    assignment: `SELECT * FROM assignment WHERE bookId IN (__IDS__)`,
    annotation: `SELECT * FROM annotation WHERE bookId IN (__IDS__)`,
    mistake: `SELECT * FROM mistake WHERE bookId IN (__IDS__)`,
    bookfavorite: `SELECT * FROM bookfavorite WHERE bookId IN (__IDS__)`,
    bookvideo: `SELECT * FROM bookvideo WHERE bookId IN (__IDS__)`,
    readingprogress: `SELECT * FROM readingprogress WHERE bookId IN (__IDS__)`,
  };
  for (const [table, sql] of Object.entries(queries)) {
    const rows = [];
    for (let i = 0; i < delIds.length; i += chunkSize) {
      const chunk = delIds.slice(i, i + chunkSize);
      try {
        const got = await prisma.$queryRawUnsafe(sql.replace('__IDS__', chunk.join(',')));
        rows.push(...got);
      } catch (e) {
        console.warn(`  备份 ${table} 失败: ${e.message.split('\n')[0]}`);
      }
    }
    related[table] = rows;
    console.log(`  备份 ${table}: ${rows.length} 行`);
  }

  fs.writeFileSync(file, JSON.stringify({ generatedAt: ts, mode: MODE, delIds, books: bookRows, related }, null, 0));
  console.log(`已写备份: ${file} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
  return file;
}

// ── soft ────────────────────────────────────────────────────────────
async function runSoft(delIds, pendingIds, markIds, keepIds) {
  fs.mkdirSync(DELETED, { recursive: true });

  console.log(`\n[1/3] 导出备份（覆盖完整待处理集合 ${pendingIds.length} 本）...`);
  if (!DRY && !NO_BACKUP) await backup(pendingIds);
  else console.log('  (跳过)');

  console.log(`\n[2/3] 移动 ${delIds.length} 个目录 → books-deleted ...`);
  const t0 = Date.now();
  let done = 0;
  const results = await pool(delIds, CONCURRENCY, async (id) => {
    const src = path.join(BOOKS, String(id));
    const dest = path.join(DELETED, String(id));
    if (!fs.existsSync(src)) return 'missing';
    if (DRY) return 'dry';
    if (fs.existsSync(dest)) await fs.promises.rm(dest, { recursive: true, force: true });
    await fs.promises.rename(src, dest);
    if (++done % 500 === 0) {
      const rate = done / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r  已移动 ${done}/${delIds.length} (${rate.toFixed(0)}/s)   `);
    }
    return 'moved';
  });
  const moved = results.filter((r) => r.ok && r.value === 'moved').length;
  const wouldMove = results.filter((r) => r.ok && r.value === 'dry').length;
  const missing = results.filter((r) => r.ok && r.value === 'missing').length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n  完成: 移动 ${moved}${DRY ? ` (dry-run 命中 ${wouldMove})` : ''}, 缺目录 ${missing}, 失败 ${failed.length}  用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (failed.length) {
    console.log('  失败明细（前 20）:');
    for (const f of failed.slice(0, 20)) console.log(`    #${f.item}: ${f.error}`);
  }

  console.log(`\n[3/3] 标记数据库 isDeleted=true（全量 ${markIds.length} 本，幂等）...`);
  if (DRY) {
    console.log('  (dry-run 跳过)');
  } else if (failed.length) {
    console.log(`  跳过：本次有 ${failed.length} 个目录移动失败，先修好文件再标记，避免库与文件不一致。`);
  } else {
    const t1 = Date.now();
    let updated = 0;
    const chunkSize = 5000;
    for (let i = 0; i < markIds.length; i += chunkSize) {
      const chunk = markIds.slice(i, i + chunkSize);
      const r = await prisma.book.updateMany({
        where: { id: { in: chunk } },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      updated += r.count;
    }
    console.log(`  已更新 ${updated} 行  用时 ${((Date.now() - t1) / 1000).toFixed(0)}s`);
  }

  // 保护性断言：保留集合一本都不该被标记为已删除
  const leaked = await prisma.book.count({ where: { id: { in: keepIds }, isDeleted: true } });
  console.log(`\n保护性断言：保留集合 ${keepIds.length} 本，被误标 isDeleted 的 = ${leaked}（应为 0）`);
  if (leaked > 0) {
    const bad = await prisma.book.findMany({
      where: { id: { in: keepIds }, isDeleted: true },
      select: { id: true, title: true },
    });
    console.log('  ⚠️ 误标清单:', JSON.stringify(bad));
  }
}

// ── purge ───────────────────────────────────────────────────────────
async function runPurge(delIds) {
  // purge 只作用于「已软删」的行，避免误删仍在用的书
  const rows = await prisma.book.findMany({
    where: { id: { in: delIds }, isDeleted: true },
    select: { id: true, title: true },
  });
  const ids = rows.map((r) => r.id);
  console.log(`待物理清除: 已软删 ∩ 待删集合 = ${ids.length} 本（删除集合共 ${delIds.length}）`);
  if (!YES && !DRY) {
    console.error('\n拒绝执行：物理清除不可逆，请追加 --yes 确认。');
    process.exit(2);
  }

  const t0 = Date.now();
  let done = 0;
  const results = await pool(ids, CONCURRENCY, async (id) => {
    if (DRY) return 'dry';
    for (const dir of [path.join(BOOKS, String(id)), path.join(DELETED, String(id)), path.join(CROPS, String(id))]) {
      if (!fs.existsSync(dir)) continue;
      // 外置盘在持续大 I/O 下可能瞬时掉线/繁忙，失败重试 3 次（指数退避）
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await fs.promises.rm(dir, { recursive: true, force: true });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      if (lastErr) throw lastErr;
    }
    if (++done % 200 === 0) process.stdout.write(`\r  已清理文件 ${done}/${ids.length}   `);
    return 'purged';
  });
  const okIds = ids.filter((_, i) => results[i]?.ok);
  const failed = results.filter((r) => !r?.ok);
  console.log(`\n  文件清理完成: ${okIds.length}, 失败 ${failed.length}  用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (failed.length) {
    console.log('  ⚠️ 失败明细（前 20）:');
    for (const f of failed.slice(0, 20)) console.log(`    #${f.item}: ${f.error}`);
  }

  if (!DRY) {
    const t1 = Date.now();
    let deleted = 0;
    const chunkSize = 2000;
    for (let i = 0; i < okIds.length; i += chunkSize) {
      const chunk = okIds.slice(i, i + chunkSize);
      const r = await prisma.book.deleteMany({ where: { id: { in: chunk } } });
      deleted += r.count;
    }
    console.log(`  已删除 book 行 ${deleted} 条（关联表由外键级联清理）  用时 ${((Date.now() - t1) / 1000).toFixed(0)}s`);
  }
}

// ── restore ─────────────────────────────────────────────────────────
/** 把 books-deleted/{id} 移回 books/{id}，并把 book.isDeleted 归 0（幂等，以 isDeleted=1 为范围） */
async function runRestore(ids) {
  const rows = await prisma.book.findMany({
    where: { id: { in: ids }, isDeleted: true },
    select: { id: true, title: true },
  });
  const targets = rows.map((r) => Number(r.id));
  console.log(`待还原: 已软删 ∩ 请求集合 = ${targets.length} 本（请求 ${ids.length} 本）`);
  if (!targets.length) { console.log('  没有需要还原的书。'); return; }
  if (!YES && !DRY) {
    console.error('\n拒绝执行：请追加 --yes 确认。');
    process.exit(2);
  }

  fs.mkdirSync(BOOKS, { recursive: true });
  const t0 = Date.now();
  const results = await pool(targets, CONCURRENCY, async (id) => {
    const src = path.join(DELETED, String(id));
    const dest = path.join(BOOKS, String(id));
    if (!fs.existsSync(src)) return 'missing';
    if (DRY) return 'dry';
    if (fs.existsSync(dest)) await fs.promises.rm(dest, { recursive: true, force: true });
    await fs.promises.rename(src, dest);
    return 'restored';
  });
  const moved = results.filter((r) => r.ok && r.value === 'restored').length;
  const wouldMove = results.filter((r) => r.ok && r.value === 'dry').length;
  const missing = results.filter((r) => r.ok && r.value === 'missing').length;
  const failed = results.filter((r) => !r.ok);
  console.log(`  目录还原: ${moved}${DRY ? ` (dry-run 命中 ${wouldMove})` : ''}, 缺目录 ${missing}, 失败 ${failed.length}  用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (failed.length) for (const f of failed.slice(0, 20)) console.log(`    #${f.item}: ${f.error}`);

  if (DRY) { console.log('  (dry-run 跳过 DB 更新)'); return; }
  if (failed.length) {
    console.log(`  跳过 DB 更新：有 ${failed.length} 个目录还原失败，先修文件再重跑，避免库与文件不一致。`);
    return;
  }

  const t1 = Date.now();
  let updated = 0;
  const chunkSize = 5000;
  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);
    const r = await prisma.book.updateMany({
      where: { id: { in: chunk } },
      data: { isDeleted: false, deletedAt: null },
    });
    updated += r.count;
  }
  console.log(`  已还原 ${updated} 行 isDeleted=0  用时 ${((Date.now() - t1) / 1000).toFixed(0)}s`);
}

// ── main ────────────────────────────────────────────────────────────
if (MODE === 'restore') {
  const raw = String(getArg('ids', ''));
  const cat = String(getArg('category', ''));
  const catLike = String(getArg('category-like', ''));
  let ids;
  if (raw === 'all') {
    ids = (await prisma.$queryRawUnsafe('SELECT id FROM book WHERE isDeleted=1')).map((r) => Number(r.id));
  } else if (raw && raw !== 'true') {
    ids = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  } else if (cat && cat !== 'true') {
    const rows = await prisma.book.findMany({
      where: { isDeleted: true, category: cat },
      select: { id: true },
    });
    ids = rows.map((r) => Number(r.id));
    console.log(`按分类还原: category = "${cat}"`);
  } else if (catLike && catLike !== 'true') {
    // 转义 LIKE 通配符，避免分类名里的 _ / % 被当成元字符
    const esc = catLike.replace(/[\\%_]/g, (m) => '\\' + m);
    const rows = await prisma.$queryRawUnsafe(
      "SELECT id, category FROM book WHERE isDeleted=1 AND category LIKE ? ESCAPE '\\\\'",
      `%${esc}%`,
    );
    ids = rows.map((r) => Number(r.id));
    const cats = [...new Set(rows.map((r) => r.category))];
    console.log(`按分类模糊还原: category LIKE "%${catLike}%" -> 命中 ${ids.length} 本，跨 ${cats.length} 个分类`);
    for (const c of cats) console.log(`    ${c}`);
  } else {
    console.error('restore 需要 --ids=<逗号分隔 bookId>、--ids=all、--category=<精确分类名> 或 --category-like=<子串>');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`还原 ${ids.length} 本${DRY ? ' (DRY-RUN 不落盘)' : ''}\n`);
  await runRestore(ids);
  await prisma.$disconnect();
  process.exit(0);
}

const KEEP = await resolveKeep();
const { keepSet, allIds, delIds: _d, moveIds, markIds, alreadyDeleted, totalPending } = await computeSets(KEEP);

let delIds = _d;
if (MODE === 'purge') {
  // purge 保留集 = 当前可见(3分类)的书 + 显式 keep-ids，其余已软删的书全部物理删除。
  // 注意：computeSets 的 delIds 基于 books/{id} 是否存在，而软删书已移到 books-deleted/，
  // 所以 purge 必须基于「isDeleted=1 且不在保留集」重新计算，否则会拿到空集合什么都不删。
  const visibleIds = (await prisma.$queryRawUnsafe(`SELECT id FROM book WHERE isDeleted=0`)).map((r) => Number(r.id));
  // 用户明确要保留的分类（必刷题/教材/笔记/配套教辅）：无论软删与否都纳入保留集，
  // 否则「软删状态的笔记族」会被当 others 误删（见 2026-10-01 事故）。
  const keepCatIds = (
    await prisma.$queryRawUnsafe(
      `SELECT id FROM book WHERE category LIKE '%必刷题%' OR category LIKE '%教材%' OR category LIKE '%笔记%' OR category LIKE '%配套教辅%'`,
    )
  ).map((r) => Number(r.id));
  const purgeKeep = new Set([...visibleIds, ...keepCatIds, ...KEEP_IDS]);
  const isDelMap = new Map(
    (await prisma.$queryRawUnsafe(`SELECT id, isDeleted FROM book`)).map((r) => [Number(r.id), !!r.isDeleted]),
  );
  delIds = allIds.filter((id) => !purgeKeep.has(id) && isDelMap.get(id));
  console.log(`purge 保留集 = 可见 ${visibleIds.length} 本 + keep-ids ${KEEP_IDS.length} 本 = ${purgeKeep.size} 本`);
  console.log(`将物理删除 ${delIds.length} 本已软删书（库行 + storage 文件，不可逆）`);
}

console.log(`保留口径       : ${KEEP.source}${KEEP.ids ? `（由 assignment 反推出 ${KEEP.ids.length} 个 bookId）` : ''}`);
console.log(`全库 ${allIds.length} 本 | 保留 ${keepSet.size} 本 | 库中已标记删除 ${alreadyDeleted} 本`);
console.log(`仍需移动目录 ${totalPending} 本 | 本次处理 ${delIds.length} 本`);

if (KEEP.ids) {
  console.log('\n保留清单:');
  const keepRows = await prisma.book.findMany({
    where: { id: { in: KEEP.ids } },
    select: { id: true, title: true, category: true, isDeleted: true },
  });
  for (const b of keepRows) {
    console.log(`  [${b.id}] ${b.title} | ${b.category} | 当前 ${b.isDeleted ? '已删' : '可见'}`);
  }
}

console.log('\n待处理抽样（前 5）:');
const sample = await prisma.book.findMany({
  where: { id: { in: delIds.slice(0, 5) } },
  select: { id: true, title: true, category: true },
});
for (const s of sample) console.log(`  [${s.id}] ${s.title} | ${s.category}`);

if (!YES && !DRY && MODE === 'soft') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((res) => rl.question(`\n确认对 ${delIds.length} 本书执行「${MODE}」？输入 yes 继续: `, res));
  rl.close();
  if (ans.trim().toLowerCase() !== 'yes') {
    console.log('已取消。');
    await prisma.$disconnect();
    process.exit(0);
  }
}

if (MODE === 'soft') await runSoft(delIds, moveIds, markIds, KEEP.ids ?? [...keepSet]);
else await runPurge(delIds);

await prisma.$disconnect();
