import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import prisma from '../prisma.js';
import { getPdfInfo, extractOutline, renderPages, getAvailableDpis, parseGradeSubjectFromPath, parseGradeSubjectFromText, inferCourseCategory, isDpiComplete, hashFile, mergeSourcePaths, normalizeSourcePaths } from '../services/pdfProcessor.js';
import { runWithDynamicConcurrency } from '../utils/concurrency.js';
import { getBookRoot, getStorageRoot, inspectStorageRoot, setStorageRoot } from '../services/storage.js';
import { execFile } from 'child_process';
import { adminRequired, AuthedRequest, getStandaloneUser } from '../middleware/auth.js';
import { invalidateBookIndexOnWrite } from '../middleware/bookIndex.js';
import { isAuthEnabled } from '../services/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createSseTicket } from '../utils/sseTicket.js';
import { scanVideos, matchVideosToPdfs, resolveVideoPath, toRelativePath } from '../services/videoMatcher.js';
import type { PdfMatchResult } from '../services/videoMatcher.js';
import { cleanPdfName, sanitizeFileName } from '../services/nameCleaner.js';

const router = Router();
// 导入/删除书等写操作后让全局书籍索引失效并后台重建
router.use(invalidateBookIndexOnWrite);
const maxConcurrency = Math.max(1, os.cpus().length - 1);
const scanConcurrency = new Map<string, { value: number }>();

/** 视频关联预处理结果（短时效，扫描开始后被消费） */
interface VideoPlanVideo {
  filePath: string;
  title: string;
  lessonNo: number | null;
  score: number;
  sortOrder: number;
}
interface VideoPlanItem {
  scope: 'lesson' | 'course';
  videos: VideoPlanVideo[];
}
interface VideoPlan {
  rootPath: string;
  items: Map<string, VideoPlanItem>;
  createdAt: number;
}
type PdfVideoMatch = PdfMatchResult;
const VIDEO_PLAN_TTL = 2 * 60 * 60 * 1000;
const videoPlans = new Map<string, VideoPlan>();

function pruneVideoPlans() {
  const cutoff = Date.now() - VIDEO_PLAN_TTL;
  for (const [id, plan] of videoPlans) {
    if (plan.createdAt < cutoff) videoPlans.delete(id);
  }
}

/** 把预处理确认过的视频写入 BookVideo（已存在的按路径更新，未在新方案里的移除） */
async function applyVideoPlan(
  bookId: number,
  pdfPath: string,
  plan: VideoPlan | undefined,
  send: (type: string, data: any) => void,
): Promise<number> {
  const entry = plan?.items.get(pdfPath);
  if (!entry) return 0;

  const existing = await prisma.bookVideo.findMany({ where: { bookId }, select: { id: true, filePath: true } });
  const keep = new Set(entry.videos.map((v) => v.filePath));
  const stale = existing.filter((v) => !keep.has(v.filePath));
  if (stale.length > 0) {
    await prisma.bookVideo.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
  }

  let count = 0;
  for (const video of entry.videos) {
    const relPath = toRelativePath(plan!.rootPath, video.filePath) || video.filePath;
    const missing = !fs.existsSync(video.filePath);
    const data = {
      title: video.title,
      fileName: path.basename(video.filePath),
      filePath: video.filePath,
      rootPath: plan!.rootPath,
      relPath,
      lessonNo: video.lessonNo,
      sortOrder: video.sortOrder,
      matchScore: video.score,
      scope: entry.scope,
      missing,
    };
    const found = existing.find((v) => v.filePath === video.filePath);
    if (found) {
      await prisma.bookVideo.update({ where: { id: found.id }, data });
    } else {
      await prisma.bookVideo.create({ data: { bookId, ...data } });
    }
    count++;
    if (missing) send('log', { message: `  ⚠ 视频文件不存在: ${path.basename(video.filePath)}` });
  }
  return count;
}

/** 把书籍标记为 course / exercise / book，失败（书已被删）不影响主流程 */
async function markBookKind(bookId: number, kind: 'book' | 'course' | 'exercise') {
  try {
    await prisma.book.update({ where: { id: bookId }, data: { kind } });
  } catch {
    /* ignore */
  }
}

router.use(adminRequired);

router.post('/scan-pdf/ticket', asyncHandler(async (req: AuthedRequest, res: Response) => {
  // 关闭鉴权（standalone 模式）下免登录，直接签发一份系统管理员票据；
  // 开启鉴权时仍要求登录态（req.user 存在），否则 401。
  const user = req.user ?? (isAuthEnabled() ? null : getStandaloneUser());
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const ticket = createSseTicket(user);
  res.json({ data: { ticket } });
}));

router.get('/scan-pdf/capacity', (_req: Request, res: Response) => {
  res.json({ cores: os.cpus().length, maxConcurrency });
});

router.post('/scan-pdf/concurrency', (req: Request, res: Response) => {
  const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : '';
  const requested = Number(req.body?.concurrency);
  const task = scanConcurrency.get(taskId);
  if (!task) return res.json({ concurrency: requested, active: false });
  task.value = Math.max(1, Math.min(maxConcurrency, Math.floor(requested)));
  res.json({ concurrency: task.value, active: true });
});

router.get('/storage', asyncHandler(async (_req: Request, res: Response) => {
  const current = await inspectStorageRoot(getStorageRoot());
  res.json(current);
}));

router.post('/storage/inspect', asyncHandler(async (req: Request, res: Response) => {
  const targetPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  if (!targetPath) return res.status(400).json({ error: '资源目录不能为空' });
  res.json(await inspectStorageRoot(targetPath));
}));

router.put('/storage', asyncHandler(async (req: Request, res: Response) => {
  const targetPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  if (!targetPath) return res.status(400).json({ error: '资源目录不能为空' });
  const inspection = await inspectStorageRoot(targetPath);
  if (!inspection.exists) fs.mkdirSync(inspection.path, { recursive: true });
  const storagePath = await setStorageRoot(inspection.path);
  res.json({ path: storagePath, matchedBooks: inspection.matchedBooks, totalBooks: inspection.totalBooks });
}));

router.post('/storage/open', (req: Request, res: Response) => {
  const storageRoot = path.resolve(getStorageRoot());
  const targetPath = typeof req.body?.path === 'string' && req.body.path.trim()
    ? path.resolve(req.body.path.trim())
    : storageRoot;
  // Whitelist: only allow paths inside storage root
  if (!targetPath.startsWith(storageRoot + path.sep) && targetPath !== storageRoot) {
    return res.status(403).json({ error: '只能打开资源目录内的路径' });
  }
  fs.mkdirSync(targetPath, { recursive: true });
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(command, [targetPath], (error) => {
    if (error) return res.status(500).json({ error: `无法打开目录: ${error.message}` });
    res.json({ success: true });
  });
});

interface PdfTask {
  pdfPath: string;
  fileName: string;
  /** 清洗掉广告噪声后用于归档拷贝的文件名（未清洗时等于 fileName） */
  cleanFileName: string;
  category: string;
  title: string;
  pages: number;
  fileHash: string;
  grade: string;
  subject: string;
}

/**
 * 清洗书名并记录使用次数：同一分类下撞名时追加 (2)(3)…，
 * 避免清洗噪声后两本书同名触发 title+category 唯一约束。
 */
function dedupeTitle(used: Map<string, number>, category: string, title: string): string {
  const key = `${category}::${title}`;
  const n = (used.get(key) || 0) + 1;
  used.set(key, n);
  return n === 1 ? title : `${title} (${n})`;
}

// Pre-scan preview: parse a directory and return parsed metadata without importing
router.post('/scan-pdf/preview', asyncHandler(async (req: Request, res: Response) => {
  const targetPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  if (!targetPath || !fs.existsSync(targetPath)) {
    return res.status(400).json({ error: '路径不存在' });
  }

  const stat = fs.statSync(targetPath);
  let pdfFiles: string[] = [];

  if (stat.isFile() && targetPath.toLowerCase().endsWith('.pdf')) {
    pdfFiles = [targetPath];
  } else if (stat.isDirectory()) {
    const scanDir = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...scanDir(fullPath));
        } else if (entry.name.toLowerCase().endsWith('.pdf')) {
          results.push(fullPath);
        }
      }
      return results;
    };
    pdfFiles = scanDir(targetPath);
  }

  const overrideGrade = typeof req.body?.grade === 'string' ? req.body.grade.trim() : '';
  const overrideSubject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const overrideCategory = typeof req.body?.category === 'string' ? req.body.category.trim() : '';

  // 可选：顺带解析 MP4 讲解视频并给出 PDF → 视频 的对应建议
  const withVideo = req.body?.withVideo === true;
  const videoRoot = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  let matchMap = new Map<string, PdfVideoMatch>();
  let videoTotal = 0;
  if (withVideo) {
    const videos = scanVideos(videoRoot);
    videoTotal = videos.length;
    const matches = matchVideosToPdfs(
      videoRoot,
      pdfFiles.map((p) => ({ fullPath: p, fileName: path.basename(p) })),
      videos,
    );
    matchMap = new Map(matches.map((m) => [m.fullPath, m]));
  }

  // 默认开启：剥掉「【爱豆爱做题】」「【一手资源更新有保障联系sanniaowl】」这类广告水印
  const cleanNames = req.body?.cleanNames !== false;
  const usedTitles = new Map<string, number>();

  const results = pdfFiles.map((pdfPath) => {
    const rawFileName = path.basename(pdfPath);
    const cleaned = cleanNames ? cleanPdfName(rawFileName) : null;
    const fileName = cleaned ? sanitizeFileName(cleaned.fileName) : rawFileName;
    const category = overrideCategory || inferCourseCategory(pdfPath);
    const title = dedupeTitle(
      usedTitles,
      category,
      cleaned ? cleaned.title : path.basename(pdfPath, '.pdf'),
    );
    const parsed = parseGradeSubjectFromPath(pdfPath);
    // 解析不出学期就留空，不要退回批次号 —— batchId 有自己的字段，
    // 把批次号写进 grade 会让首页「学期」筛选里冒出一串时间戳。
    const grade = overrideGrade || parsed.grade || parseGradeSubjectFromText(title).grade;
    const m = matchMap.get(pdfPath);
    return {
      fileName,
      rawFileName,
      renamed: !!cleaned?.changed,
      fullPath: pdfPath,
      category,
      grade,
      subject: overrideSubject || parsed.subject,
      title,
      ...(withVideo
        ? {
            videoScope: m?.scope ?? 'lesson',
            videoLessonNo: m?.lessonNo ?? null,
            videoMatches: m?.matches ?? [],
          }
        : {}),
    };
  });

  const videoLinks = withVideo
    ? results.reduce((sum, r: any) => sum + (r.videoMatches || []).filter((v: any) => v.selected).length, 0)
    : 0;

  res.json({
    files: results,
    total: results.length,
    videoRoot,
    videoStats: withVideo ? { videos: videoTotal, links: videoLinks } : null,
  });
}));

/**
 * 提交「视频关联预处理」结果，供随后的扫描任务消费。
 * 匹配结果可能很大，不适合塞进 SSE 的 query string，所以先落一个短时效的 plan。
 */
router.post('/scan-pdf/video-plan', asyncHandler(async (req: Request, res: Response) => {
  const rootPath = typeof req.body?.rootPath === 'string' ? req.body.rootPath.trim() : '';
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rootPath) {
    res.status(400).json({ error: '缺少资源根目录' });
    return;
  }

  const planItems = new Map<string, VideoPlanItem>();
  for (const raw of items) {
    const pdfPath = typeof raw?.pdfPath === 'string' ? raw.pdfPath : '';
    if (!pdfPath) continue;
    const videos: VideoPlanVideo[] = [];
    const seen = new Set<string>();
    const list = Array.isArray(raw?.videos) ? raw.videos : [];
    list.forEach((v: any, index: number) => {
      const filePath = typeof v?.filePath === 'string' ? v.filePath : '';
      if (!filePath || seen.has(filePath)) return;
      seen.add(filePath);
      videos.push({
        filePath,
        title: typeof v?.title === 'string' && v.title ? v.title : path.basename(filePath, path.extname(filePath)),
        lessonNo: typeof v?.lessonNo === 'number' ? v.lessonNo : null,
        score: typeof v?.score === 'number' ? v.score : 0,
        sortOrder: index,
      });
    });
    planItems.set(pdfPath, {
      scope: raw?.scope === 'course' ? 'course' : 'lesson',
      videos,
    });
  }

  const planId = crypto.randomUUID();
  videoPlans.set(planId, { rootPath, items: planItems, createdAt: Date.now() });
  pruneVideoPlans();
  res.json({ data: { planId, pdfs: planItems.size, links: [...planItems.values()].reduce((s, i) => s + i.videos.length, 0) } });
}));

router.get('/scan-pdf', async (req: Request, res: Response) => {
  const targetPath = req.query.targetPath as string;
  const explicitCategory = req.query.category as string;
  const explicitGrade = req.query.grade as string;
  const explicitSubject = req.query.subject as string;
  const skipDb = req.query.skipDb === 'true';
  // 视频关联预处理结果（由前端确认后先 POST 到 /scan-pdf/video-plan）
  const videoPlanId = typeof req.query.videoPlan === 'string' ? req.query.videoPlan : '';
  // 注意：不在读取时删除，扫描中断后可以直接用同一个方案重试
  const videoPlan = videoPlanId ? videoPlans.get(videoPlanId) : undefined;
  // 资源类型：带视频关联方案的批次整批标记为 course（首页单独页面展示）；可用 ?kind= 显式覆盖。
  // 整批处理而不是「按单个 PDF 有没有视频」—— 否则一门课里没匹配到视频的那几本讲义
  // 会被标成 book，在课程页里就凭空少了几本。
  const requestedKind = typeof req.query.kind === 'string' ? req.query.kind.trim() : '';
  const bookKind: 'book' | 'course' =
    requestedKind === 'course' || requestedKind === 'book' ? requestedKind : videoPlan ? 'course' : 'book';
  const dpi = parseInt((req.query.dpi as string) || '300', 10);
  // Concurrency: default to min(4, cores-1), cap at 8 to avoid choking the system
  const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : crypto.randomUUID();
  const initialConcurrency = Math.max(1, Math.min(maxConcurrency, parseInt((req.query.concurrency as string) || String(Math.min(4, maxConcurrency)), 10)));
  const concurrencyState = { value: initialConcurrency };
  scanConcurrency.set(taskId, concurrencyState);

  // Batch ID: YYYYMMDDHHmmss — all books imported in this scan share the same batchId
  const now = new Date();
  const batchId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // 反向代理（nginx 等）默认会缓冲响应体，SSE 必须显式关掉
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 日志节流：窗口内合并成一批，但**距上次发送已超过窗口就立刻发**。
  // 单纯用 setTimeout 会在事件循环被渲染任务占满时攒出一大坨，表现为
  // 「卡很久 → 突然刷出一屏」。进度仍然 100ms 更新一次。
  const LOG_FLUSH_MS = 80;
  let pendingLogs: { message: string }[] = [];
  let lastProgress: any = null;
  let logTimer: NodeJS.Timeout | null = null;
  let progressTimer: NodeJS.Timeout | null = null;
  let lastLogFlush = 0;

  const flushLogs = () => {
    logTimer = null;
    lastLogFlush = Date.now();
    if (pendingLogs.length === 0) return;
    const batch = pendingLogs;
    pendingLogs = [];
    // Send all logs in one SSE message as a batch array
    res.write(`event: logBatch\n`);
    res.write(`data: ${JSON.stringify({ messages: batch.map(l => l.message) })}\n\n`);
  };

  const flushProgress = () => {
    progressTimer = null;
    if (!lastProgress) return;
    res.write(`event: progress\n`);
    res.write(`data: ${JSON.stringify(lastProgress)}\n\n`);
    lastProgress = null;
  };

  const send = (type: string, data: any) => {
    if (type === 'error' || type === 'done') {
      if (logTimer) { clearTimeout(logTimer); logTimer = null; }
      if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
      flushLogs();
      flushProgress();
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      return;
    }
    if (type === 'progress') {
      lastProgress = data;
      if (!progressTimer) {
        progressTimer = setTimeout(flushProgress, 100);
      }
    } else {
      pendingLogs.push(data);
      const since = Date.now() - lastLogFlush;
      if (since >= LOG_FLUSH_MS) {
        flushLogs();
      } else if (!logTimer) {
        logTimer = setTimeout(flushLogs, LOG_FLUSH_MS - since);
      }
    }
  };

  const fmtTime = (s: number) => {
    if (s < 60) return `${Math.round(s)}秒`;
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return `${m}分${r}秒`;
  };

  try {
    if (!targetPath || !fs.existsSync(targetPath)) {
      send('error', { message: `路径不存在: ${targetPath}` });
      return res.end();
    }

    const stat = fs.statSync(targetPath);
    let pdfFiles: string[] = [];

    if (stat.isFile() && targetPath.toLowerCase().endsWith('.pdf')) {
      pdfFiles = [targetPath];
    } else if (stat.isDirectory()) {
      const scanDir = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const results: string[] = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results.push(...scanDir(fullPath));
          } else if (entry.name.toLowerCase().endsWith('.pdf')) {
            results.push(fullPath);
          }
        }
        return results;
      };
      pdfFiles = scanDir(targetPath);
    }

    if (pdfFiles.length === 0) {
      send('error', { message: '未找到 PDF 文件' });
      return res.end();
    }

    send('log', { message: `扫描完成，找到 ${pdfFiles.length} 个 PDF 文件，目标 DPI=${dpi}，并发数=${concurrencyState.value}` });
    if (videoPlan) {
      const linkCount = [...videoPlan.items.values()].reduce((s, i) => s + i.videos.length, 0);
      send('log', { message: `视频关联方案已载入：${videoPlan.items.size} 个 PDF，共 ${linkCount} 条视频关联（根目录 ${videoPlan.rootPath}）` });
    }

    // 预先按固定顺序算好书名（Phase 1 是并发的，边算边去重会导致与预解析结果不一致）
    const cleanNames = req.query.cleanNames !== 'false';
    const usedTitles = new Map<string, number>();
    const titleByPath = new Map<string, string>();
    const cleanNameByPath = new Map<string, string>();
    for (const pdfPath of pdfFiles) {
      const name = path.basename(pdfPath);
      const cleaned = cleanNames ? cleanPdfName(name) : null;
      const cat = explicitCategory || inferCourseCategory(pdfPath);
      const rawTitle = path.basename(pdfPath, '.pdf');
      titleByPath.set(pdfPath, dedupeTitle(usedTitles, cat, cleaned ? cleaned.title || rawTitle : rawTitle));
      cleanNameByPath.set(pdfPath, cleaned ? sanitizeFileName(cleaned.fileName) : name);
    }

    // Phase 1: collect PDF info (async — pdfinfo and hash are non-blocking)
    const tasks: PdfTask[] = [];
    let phase1Done = 0;
    const phase1Total = pdfFiles.length;
    const phase1Interval = Math.max(10, Math.floor(phase1Total / 20));
    const phase1Start = Date.now();
    await runWithDynamicConcurrency(pdfFiles, () => Math.min(maxConcurrency, concurrencyState.value * 2), async (pdfPath: string) => {
      const fileName = path.basename(pdfPath);
      try {
        const info = await getPdfInfo(pdfPath);
        const pdfCategory = explicitCategory || inferCourseCategory(pdfPath);
        const cleanFileName = cleanNameByPath.get(pdfPath) || fileName;
        const title = titleByPath.get(pdfPath) || path.basename(pdfPath, '.pdf') || info.title;
        const { grade: parsedGrade, subject: parsedSubject } = parseGradeSubjectFromPath(pdfPath);
        // 解析不出学期就留空：batchId 单独存字段，塞进 grade 会污染首页的学期筛选
        const grade = explicitGrade || parsedGrade || parseGradeSubjectFromText(title).grade;
        const subject = explicitSubject || parsedSubject;
        const fileHash = await hashFile(pdfPath);
        if (cleanFileName !== fileName) {
          send('log', { message: `清洗文件名: ${fileName} → ${cleanFileName}` });
        }
        tasks.push({ pdfPath, fileName, cleanFileName, category: pdfCategory, title, pages: info.pages, fileHash, grade, subject });
      } catch {
        send('log', { message: `跳过（无法读取）: ${fileName}` });
      }
      phase1Done++;
      if (phase1Done % phase1Interval === 0 || phase1Done === phase1Total) {
        const elapsed = (Date.now() - phase1Start) / 1000;
        const rate = phase1Done / elapsed;
        const remaining = (phase1Total - phase1Done) / rate;
        send('progress', {
          phase: 1,
          current: phase1Done,
          total: phase1Total,
          message: `分析中: ${phase1Done}/${phase1Total} 剩余 ${fmtTime(remaining)}`,
        });
      }
    });

    const totalPages = tasks.reduce((s, t) => s + t.pages, 0);
    send('log', { message: `共 ${tasks.length} 个有效 PDF，合计 ${totalPages} 页` });

    // 学期解析不出来的文件留空（不再用批次号顶替），这里汇总提醒一次，
    // 方便在导入前的预览里手动指定「学期」覆盖。
    const gradeMissing = tasks.filter((t) => !t.grade);
    if (gradeMissing.length) {
      const shown = gradeMissing.slice(0, 5).map((t) => t.fileName).join('、');
      send('log', {
        message: `提示：${gradeMissing.length} 个文件无法从文件名/目录推断学期，grade 已留空（示例：${shown}${gradeMissing.length > 5 ? ' 等' : ''}）。可在预览里指定学期后重新导入。`,
      });
    }

    // Pre-scan: build lookup maps for existing books by title::category and by file hash.
    const existingBooks = await prisma.book.findMany({
      select: { id: true, title: true, category: true, fileHash: true, sourcePaths: true },
      where: { isDeleted: false },
    });
    const existingMap = new Map<string, number>();
    const hashLookup = new Map<string, number[]>();
    for (const b of existingBooks) {
      existingMap.set(`${b.title}::${b.category}`, b.id);
      if (b.fileHash) {
        const bookIds = hashLookup.get(b.fileHash) || [];
        bookIds.push(b.id);
        hashLookup.set(b.fileHash, bookIds);
      }
    }

    // Phase 2a: separate already-complete tasks from ones needing processing,
    // while also skipping any duplicate PDF content discovered in this batch.
    const toProcess: PdfTask[] = [];
    const seenHashes = new Set<string>();
    const extraPathsByHash = new Map<string, string[]>(); // within-batch duplicate paths to merge later
    let skippedComplete = 0;
    let skippedIncomplete = 0;
    let skippedDupContent = 0;
    let skippedDupBatch = 0;

    for (const task of tasks) {
      // Content identity wins over filename/category. A PDF that already exists
      // anywhere in the library only adds its source path and is never rendered again.
      const duplicateIds = hashLookup.get(task.fileHash) || [];
      if (duplicateIds.length > 0) {
        const sourceBooks = await prisma.book.findMany({
          where: { id: { in: duplicateIds } },
          select: { id: true, sourcePaths: true },
        });
        const mergedPaths = mergeSourcePaths(...sourceBooks.map((book) => book.sourcePaths), task.pdfPath);
        await Promise.all(sourceBooks.map((book) => prisma.book.update({
          where: { id: book.id },
          data: { sourcePaths: mergedPaths as any },
        })));
        seenHashes.add(task.fileHash);
        skippedDupContent++;
        send('log', { message: `跳过（重复文件内容）: ${task.fileName} → 已记录路径到已有书籍` });
        if (videoPlan && duplicateIds.length > 0) {
          const n = await applyVideoPlan(duplicateIds[0], task.pdfPath, videoPlan, send);
          if (n > 0) {
            send('log', { message: `  关联 ${n} 个讲解视频` });
            await markBookKind(duplicateIds[0], 'course');
          }
        }
        continue;
      }

      const bookId = existingMap.get(`${task.title}::${task.category}`);
      const existing = bookId ? existingBooks.find((b) => b.id === bookId) : null;

      if (existing) {
        const bookDir = getBookRoot(existing.id);

        // Same title + category AND same content (hash matches)
        if (existing.fileHash === task.fileHash) {
          if (isDpiComplete(bookDir, dpi, task.pages)) {
            skippedComplete++;
            send('log', { message: `跳过（已导入）: ${task.fileName}` });
            if (videoPlan) {
              const n = await applyVideoPlan(existing.id, task.pdfPath, videoPlan, send);
              if (n > 0) {
                send('log', { message: `  关联 ${n} 个讲解视频` });
                await markBookKind(existing.id, 'course');
              }
            }
            continue;
          }
          // Incomplete but same content → re-render to complete the pages
          skippedIncomplete++;
          seenHashes.add(task.fileHash);
          toProcess.push(task);
          continue;
        }

        // Same title + category but different content (hash changed) → re-render
        skippedIncomplete++;
        seenHashes.add(task.fileHash);
        toProcess.push(task);
        continue;
      }

      // Different title/category. Check if content already exists in DB.
      if (seenHashes.has(task.fileHash)) {
        // Duplicate within this batch — record path for the first occurrence
        const extras = extraPathsByHash.get(task.fileHash) || [];
        extras.push(task.pdfPath);
        extraPathsByHash.set(task.fileHash, extras);
        skippedDupBatch++;
        send('log', { message: `跳过（本批次重复内容）: ${task.fileName}` });
        continue;
      }

      // Brand new book
      seenHashes.add(task.fileHash);
      toProcess.push(task);
    }

    send('log', { message: `预检完成: 已导入跳过 ${skippedComplete}，重渲 ${skippedIncomplete}，内容重复跳过 ${skippedDupContent + skippedDupBatch}，需渲染 ${toProcess.length} 本` });

    if (toProcess.length === 0) {
      send('done', { message: `全部完成，所有 ${tasks.length} 个 PDF 均已导入，无需处理`, count: tasks.length, elapsed: 0 });
      return res.end();
    }

    const pagesToProcess = toProcess.reduce((s, t) => s + t.pages, 0);
    const secPerPage = 0.3 * (dpi / 150);
    send('log', { message: `预计渲染 ${pagesToProcess} 页，并发=${concurrencyState.value}，预计耗时: ${fmtTime(pagesToProcess * secPerPage / concurrencyState.value)}` });

    const startTime = Date.now();
    let processedPages = 0;
    const pageProgress: Record<number, number> = {};

    // Phase 2b: process books with a concurrency pool
    await runWithDynamicConcurrency(toProcess, () => concurrencyState.value, async (task: PdfTask, idx: number) => {
      send('log', { message: `[${idx + 1}/${toProcess.length}] 正在处理: ${task.fileName}` });

      let createdBookId: number | null = null;
      try {
        let bookId: number;
        let bookDir: string;

        if (skipDb) {
          // skipDb mode: find book by hash, only render images to storage
          const existingByHash = await prisma.book.findFirst({
            where: { fileHash: task.fileHash, isDeleted: false },
            select: { id: true },
          });
          if (!existingByHash) {
            send('log', { message: `  ✗ 跳过（数据库中无匹配记录）: ${task.fileName}` });
            return;
          }
          bookId = existingByHash.id;
          bookDir = getBookRoot(bookId);
          send('log', { message: `  匹配到 Book ID=${bookId}` });
        } else {
          const existing = await prisma.book.findFirst({
            where: { title: task.title, category: task.category, isDeleted: false },
          });

          let isNew = false;

          if (existing) {
            bookId = existing.id;
            bookDir = getBookRoot(bookId);
            const dpiDir = path.join(bookDir, String(dpi));

            const mergedSourcePaths = mergeSourcePaths(existing.sourcePaths, task.pdfPath, ...(extraPathsByHash.get(task.fileHash) || []));
            if (!existing.fileHash || existing.fileHash !== task.fileHash) {
              await prisma.book.update({
                where: { id: bookId },
                data: {
                  fileHash: task.fileHash,
                  sourcePaths: mergedSourcePaths as any,
                },
              });
            }

            if ((!existing.grade || !existing.subject) && (task.grade || task.subject)) {
              await prisma.book.update({
                where: { id: bookId },
                data: {
                  ...(task.grade && !existing.grade ? { grade: task.grade } : {}),
                  ...(task.subject && !existing.subject ? { subject: task.subject } : {}),
                },
              });
              send('log', { message: `  补全阶段/学科: ${task.grade || '-'} / ${task.subject || '-'}` });
            }

            // Re-render incomplete or missing DPI
            const existingDpis = getAvailableDpis(bookDir);
            if (existingDpis.includes(dpi)) {
              send('log', { message: `  DPI=${dpi} 渲染不完整，重新渲染...` });
              await fs.promises.rm(dpiDir, { recursive: true, force: true });
            } else {
              send('log', { message: `  新增 DPI=${dpi} 渲染（已有: ${existingDpis.join(', ') || '无'}）` });
            }
          } else {
            send('log', { message: `  提取目录...` });
            const toc = await extractOutline(task.pdfPath, task.pages);
            send('log', { message: `  目录提取完成，${toc.length} 个条目` });

            const book = await prisma.book.create({
              data: {
                title: task.title,
                category: task.category,
                grade: task.grade,
                subject: task.subject,
                batchId,
                kind: bookKind,
                totalPages: task.pages,
                storagePath: '',
                fileHash: task.fileHash,
                sourcePaths: [task.pdfPath, ...(extraPathsByHash.get(task.fileHash) || [])] as any,
                tocJson: toc as any,
              },
            });
            bookId = book.id;
            isNew = true;
            createdBookId = bookId;
            bookDir = getBookRoot(bookId);
            send('log', { message: `  创建书籍记录: ID=${bookId} (阶段=${task.grade || '-'} 学科=${task.subject || '-'})` });
          }

          // 注意：这里必须异步。同步拷贝一个几十 MB 的 PDF 会把事件循环堵死，
          // SSE 日志就会「卡很久突然吐一大段」。
          await fs.promises.mkdir(bookDir, { recursive: true });
          const archived = await fs.promises.readdir(bookDir);
          const hasArchivedPdf = archived.some((name) => name.toLowerCase().endsWith('.pdf'));
          if (!hasArchivedPdf) {
            await fs.promises.copyFile(task.pdfPath, path.join(bookDir, path.basename(task.cleanFileName || task.fileName)));
          }
        }
        const dpiDir = path.join(bookDir, String(dpi));
        send('log', { message: `  开始渲染 ${task.pages} 页 (DPI=${dpi})...` });

        let lastSentPct = -1;
        let lastSentTime = 0;
        const images = await renderPages(task.pdfPath, dpiDir, dpi, task.pages, (current) => {
          const prev = pageProgress[idx] || 0;
          const delta = current - prev;
          pageProgress[idx] = current;
          processedPages += delta;
          const overallProgress = (processedPages / pagesToProcess) * 100;
          const pct = Math.round(overallProgress);
          const now = Date.now();
          // Thin: only send when pct changes by ≥1% or 2s since last send
          if (pct === lastSentPct && now - lastSentTime < 2000) return;
          lastSentPct = pct;
          lastSentTime = now;
          const elapsed = (now - startTime) / 1000;
          const remaining = (pagesToProcess - processedPages) * secPerPage / concurrencyState.value;
          send('progress', {
            current,
            total: task.pages,
            overallCurrent: processedPages,
            overallTotal: pagesToProcess,
            overallPct: pct,
            elapsed: Math.round(elapsed),
            remaining: Math.round(remaining),
          });
        });

        const allDpis = getAvailableDpis(bookDir);
        if (!skipDb) {
          const storagePath = `/storage/books/${bookId}/`;
          const existingForUpdate = await prisma.book.findUnique({ where: { id: bookId }, select: { sourcePaths: true } });
          const finalSourcePaths = mergeSourcePaths(existingForUpdate?.sourcePaths, task.pdfPath, ...(extraPathsByHash.get(task.fileHash) || []));
          await prisma.book.update({
            where: { id: bookId },
            data: { storagePath, totalPages: task.pages, batchId, fileHash: task.fileHash, sourcePaths: finalSourcePaths as any },
          });

          if (videoPlan) {
            const n = await applyVideoPlan(bookId, task.pdfPath, videoPlan, send);
            if (n > 0) {
              send('log', { message: `  关联 ${n} 个讲解视频` });
              await markBookKind(bookId, 'course');
            }
          }
        }

        send('log', { message: `  渲染完成，共 ${images.length} 张图片，可用 DPI: ${allDpis.join(', ')}` });
        send('log', { message: `  ✓ 处理完成: ${task.title} (${task.pages}页)` });
      } catch (err: any) {
        // Rollback: delete newly created book record if render failed
        if (createdBookId !== null) {
          try {
            await prisma.book.delete({ where: { id: createdBookId } });
            const failedDir = getBookRoot(createdBookId);
            await fs.promises.rm(failedDir, { recursive: true, force: true });
            send('log', { message: `  已回滚: 删除半残书籍记录 ID=${createdBookId}` });
          } catch { /* book may already be deleted */ }
        }
        send('log', { message: `  ✗ 处理失败: ${err.message}` });
      }
    });

    const elapsedTotal = (Date.now() - startTime) / 1000;
    send('done', {
      message: `全部完成，处理 ${toProcess.length} 个 PDF（跳过已导入 ${skippedComplete} 个），耗时 ${fmtTime(elapsedTotal)}`,
      count: toProcess.length,
      elapsed: Math.round(elapsedTotal),
    });
  } catch (err: any) {
    send('error', { message: `系统错误: ${err.message}` });
  } finally {
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    scanConcurrency.delete(taskId);
    res.end();
  }
});

export default router;
