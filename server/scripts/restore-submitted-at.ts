/**
 * 从 MySQL binlog 还原的精确提交时间（CST 本地时间），回写到 assignment.submittedAt。
 * 时间来源：binlog 中 status 从非 submitted 变为 submitted 的 Update_rows 事件时间戳。
 * 已排除本仓库 reset 脚本产生的 submitted->submitted 噪声。
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// id -> 最后一次真正提交的时间 (CST, 'YYYY-MM-DD HH:MM:SS')
const submitTimes: Record<number, string> = {
  90:  '2026-09-22 23:52:48',
  98:  '2026-09-22 23:52:41',
  99:  '2026-09-22 23:52:35',
  100: '2026-09-22 23:52:27',
  101: '2026-09-19 22:37:57',
  102: '2026-09-19 22:52:42',
  111: '2026-09-22 22:54:13',
  116: '2026-09-22 23:25:03',
  117: '2026-09-23 23:58:14',
  118: '2026-09-25 19:37:11',
  119: '2026-09-25 20:13:47',
  120: '2026-09-25 21:35:56',
  122: '2026-09-25 22:00:22',
  123: '2026-09-26 21:28:41',
  124: '2026-09-26 21:41:16',
  125: '2026-09-26 21:49:31',
  126: '2026-09-26 22:02:19',
  130: '2026-09-27 18:13:51',
  132: '2026-09-27 18:40:31',
};

async function main() {
  for (const [id, ts] of Object.entries(submitTimes)) {
    const res = await prisma.$executeRawUnsafe(
      `UPDATE \`assignment\` SET submittedAt = ? WHERE id = ?`,
      new Date(ts),
      Number(id),
    );
    console.log(`assignment #${id}: submittedAt = ${ts} (affected: ${res})`);
  }

  // 验证
  const rows = await prisma.$queryRawUnsafe<{id: bigint; createdAt: Date; submittedAt: Date}[]>(
    `SELECT id, createdAt, submittedAt FROM \`assignment\` ORDER BY id`,
  );
  console.log('\n--- verification (id | createdAt | submittedAt | duration_min) ---');
  for (const r of rows) {
    const dur = r.submittedAt
      ? Math.round((r.submittedAt.getTime() - new Date(r.createdAt).getTime()) / 60000)
      : null;
    console.log(`#${r.id} | ${r.createdAt.toISOString().slice(0,16)} | ${r.submittedAt?.toISOString().slice(0,16) ?? 'NULL'} | ${dur}min`);
  }
}

main().catch(console.error).finally(async () => { await prisma.$disconnect(); });
