/**
 * 修复历史导入把「批次号」写进 grade 的脏数据。
 *
 * 背景：早期导入流程在无法从文件名/目录解析出学期时，直接用 batchId 顶替 grade，
 * 于是首页「学期」筛选里冒出一串 14 位时间戳。batchId 本来就有独立字段，不该混进 grade。
 *
 * 用法（在 server 目录下）：
 *   npx tsx scripts/fix-batch-grade.ts          # 干跑，只打印将要做的修改
 *   npx tsx scripts/fix-batch-grade.ts --apply  # 真正写库
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { parseGradeSubjectFromText } from '../src/services/pdfProcessor.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const TIMESTAMP_GRADE = /^\d{14}$/;

async function main() {
  // 先取 grade 的去重取值（很便宜），再筛出形如 14 位时间戳的批次号
  const gradeBuckets = await prisma.book.groupBy({
    by: ['grade'],
    where: { isDeleted: false },
    _count: { _all: true },
  });
  const dirtyGrades = gradeBuckets
    .map((g) => g.grade)
    .filter((g) => TIMESTAMP_GRADE.test(g));

  if (dirtyGrades.length === 0) {
    console.log('没有 grade 被写成批次号的数据，无需修复。');
    return;
  }

  const dirty = await prisma.book.findMany({
    where: { isDeleted: false, grade: { in: dirtyGrades } },
    select: { id: true, title: true, grade: true, subject: true, category: true, batchId: true, kind: true, sourcePaths: true },
    orderBy: { id: 'asc' },
  });

  console.log(`发现 grade 被写成批次号的书：${dirty.length} 本`);
  if (dirty.length === 0) return;

  const fixable: { id: number; grade: string; subject: string; from: string }[] = [];
  const unfixable: typeof dirty = [];

  for (const b of dirty) {
    const candidates = [b.title, ...(Array.isArray(b.sourcePaths) ? (b.sourcePaths as string[]) : [])];
    let grade = '';
    let subject = '';
    for (const text of candidates) {
      if (typeof text !== 'string' || !text) continue;
      const r = parseGradeSubjectFromText(text);
      if (!grade && r.grade) grade = r.grade;
      if (!subject && r.subject) subject = r.subject;
      if (grade) break;
    }
    if (grade) {
      fixable.push({ id: b.id, grade, subject, from: b.grade });
    } else {
      unfixable.push(b);
    }
  }

  console.log(`\n=== 可自动修正（${fixable.length}）===`);
  for (const f of fixable) {
    const book = dirty.find((b) => b.id === f.id)!;
    console.log(`#${f.id} [${book.kind}] ${book.subject} ${f.from} -> ${f.grade} | ${book.title}`);
  }

  console.log(`\n=== 无法从书名推断，保持原样（${unfixable.length}）===`);
  const byBatch = new Map<string, number>();
  for (const b of unfixable) byBatch.set(b.batchId || '(空)', (byBatch.get(b.batchId || '(空)') || 0) + 1);
  for (const [batch, n] of byBatch) console.log(`  批次 ${batch}: ${n} 本`);
  for (const b of unfixable.slice(0, 10)) console.log(`  #${b.id} ${b.title}`);
  if (unfixable.length > 10) console.log(`  … 其余 ${unfixable.length - 10} 本`);

  if (!APPLY) {
    console.log('\n（干跑模式，未写库。加 --apply 执行修改）');
    return;
  }

  let done = 0;
  for (const f of fixable) {
    await prisma.book.update({
      where: { id: f.id },
      data: { grade: f.grade, ...(f.subject ? { subject: f.subject } : {}) },
    });
    done++;
  }
  console.log(`\n已更新 ${done} 本。`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
