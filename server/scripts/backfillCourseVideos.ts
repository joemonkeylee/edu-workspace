/**
 * 一次性回填：把已经导入但漏掉视频关联的「朱涛数学2026」书籍
 * 重新匹配视频并写入 BookVideo，同时把 kind 标成 course。
 *
 * 背景：之前那次扫描因为视频关联方案（videoPlan）没生效，
 * 227 本里只有 194 本进了库且全部 kind='book'、0 条视频关联，
 * 导致首页「视频课程」Tab 显示 0。这里直接对这批书重跑匹配，不重新渲染 PDF。
 *
 * 用法：DATABASE_URL=... npx tsx scripts/backfillCourseVideos.ts
 * 幂等：每本书先删旧 BookVideo 再重建，可重复执行。
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { scanVideos, matchVideosToPdfs, toRelativePath } from '../src/services/videoMatcher';

const ROOT_CATEGORY = '朱涛数学2026';
const RESOURCE_ROOT = '/Users/lizhen/Downloads/朱涛数学2026';

async function main() {
  const prisma = new PrismaClient();
  try {
    const books = await prisma.book.findMany({
      where: { category: ROOT_CATEGORY, isDeleted: false },
      select: { id: true, title: true, sourcePaths: true },
    });
    console.log(`[backfill] 找到 ${books.length} 本 ${ROOT_CATEGORY} 书籍`);

    const videos = scanVideos(RESOURCE_ROOT);
    console.log(`[backfill] 扫描到 ${videos.length} 个视频文件`);

    const pdfs = books.map((b) => {
      const fullPath = Array.isArray(b.sourcePaths) && b.sourcePaths.length > 0 ? b.sourcePaths[0] : '';
      return { fullPath, fileName: fullPath ? path.basename(fullPath) : b.title };
    });
    const results = matchVideosToPdfs(RESOURCE_ROOT, pdfs, videos);

    let totalLinks = 0;
    let courseBooks = 0;
    let booksWithVideo = 0;

    for (let i = 0; i < books.length; i++) {
      const book = books[i];
      const result = results[i];
      // 整批标 course：即使某本没匹配到视频，也必须在「视频课程」Tab 可见
      await prisma.book.update({ where: { id: book.id }, data: { kind: 'course' } });
      courseBooks++;

      // 先清旧的，保证幂等
      await prisma.bookVideo.deleteMany({ where: { bookId: book.id } });

      const chosen = (result?.matches || []).filter((m) => m.selected);
      if (chosen.length > 0) {
        await prisma.bookVideo.createMany({
          data: chosen.map((m, idx) => ({
            bookId: book.id,
            title: m.title,
            fileName: m.fileName,
            filePath: m.filePath,
            rootPath: RESOURCE_ROOT,
            relPath: toRelativePath(RESOURCE_ROOT, m.filePath),
            lessonNo: m.lessonNo,
            sortOrder: idx,
            matchScore: m.score,
            scope: result?.scope ?? 'lesson',
            missing: !fs.existsSync(m.filePath),
          })),
        });
        totalLinks += chosen.length;
        booksWithVideo++;
      }
    }

    console.log(
      `[backfill] 完成：标记 ${courseBooks} 本课程（其中 ${booksWithVideo} 本有视频），` +
      `共写入 ${totalLinks} 条视频关联`
    );
  } catch (e) {
    console.error('[backfill] 失败:', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
