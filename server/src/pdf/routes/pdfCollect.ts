import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'child_process';
import { adminRequired, AuthedRequest } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { importColumnItems } from '../services/columnImport.js';
import prisma from '../../prisma.js';

/**
 * PDF 专栏预分析：把 scripts/collect-scan.py 跑出来的 collect-tree.json /
 * collect-files.json 直接喂给管理后台，让人工在入库前「看预分析结果、按目录批量修正」。
 *
 * 设计要点（与既有 /scan/preview 的区别）：
 *   · 既有 scan 是「扫 storage 目录 → 直接入库」流水线；
 *   · 这里是「扫外部资料盘 → 只预览 / 标注」，真正的复制+入库是 P3（/scan/commit 复用）。
 *   · 数据来自离线脚本产物（默认 /tmp/pdf-collect），后端只负责读取与重跑脚本，不碰数据库。
 */

const router = Router();
router.use(adminRequired);

// 源盘 / 产物目录：默认走数据源约定位置，可用 env 覆盖。
const COLLECT_SRC = process.env.PDF_COLLECT_SRC || '/Volumes/WD10JPVT-75/资料';
const COLLECT_OUT = process.env.PDF_COLLECT_OUT || '/tmp/pdf-collect';

// 目标盘（专栏 PDF 落盘根）——入库 / 磁盘预估 / 清空 / 删除都以它为准
const COLUMN_ROOT = process.env.COLUMN_PDF_ROOT || '/Volumes/COLORFUL256/source/pdf';

/**
 * 允许被「物理删除 / 清空」操作的根目录白名单。
 * 任何删除目标都必须**严格位于**其中之一内部（不能等于根本身），否则拒绝执行。
 * 可用 env PDF_COLLECT_ALLOW_ROOTS（逗号分隔）追加。
 */
export function allowedRoots(): string[] {
  const roots = new Set<string>();
  const add = (p?: string) => { if (p && p.trim()) roots.add(path.resolve(p.trim())); };
  add(COLLECT_SRC);
  add(COLUMN_ROOT);
  (process.env.PDF_COLLECT_ALLOW_ROOTS || '').split(',').forEach(add);
  return Array.from(roots);
}

/** child 是否严格位于 root 内部（不含 root 自身） */
export function isStrictlyInside(child: string, root: string): boolean {
  const rel = path.relative(root, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 校验一个待删除路径；返回 null 表示通过，否则返回拒绝原因 */
export function guardDeletable(p: string): { abs: string; error?: string } {
  const abs = path.resolve(p);
  const roots = allowedRoots();
  if (!roots.some((r) => isStrictlyInside(abs, r))) {
    return { abs, error: `不在允许删除的根目录内（仅允许：${roots.join(' / ')} 之下的子路径）` };
  }
  if (!fs.existsSync(abs)) return { abs, error: '路径不存在' };
  const lst = fs.lstatSync(abs);
  if (lst.isSymbolicLink()) return { abs, error: '符号链接，拒绝删除' };
  return { abs };
}

/** 递归统计目录/文件体积与文件数（不跟随符号链接） */
export function statRecursive(p: string): { sizeBytes: number; fileCount: number; dirCount: number } {
  let sizeBytes = 0;
  let fileCount = 0;
  let dirCount = 0;
  const stack: string[] = [p];
  while (stack.length) {
    const cur = stack.pop()!;
    let lst: fs.Stats;
    try { lst = fs.lstatSync(cur); } catch { continue; }
    if (lst.isSymbolicLink()) continue;
    if (lst.isDirectory()) {
      dirCount++;
      let entries: string[] = [];
      try { entries = fs.readdirSync(cur); } catch { continue; }
      for (const e of entries) stack.push(path.join(cur, e));
    } else if (lst.isFile()) {
      fileCount++;
      sizeBytes += lst.size;
    }
  }
  return { sizeBytes, fileCount, dirCount };
}

/** 磁盘空间（statfs）；Node 18.15+ / 22 支持 */
export function diskInfo(p: string): { path: string; totalBytes: number; freeBytes: number; usedBytes: number } | null {
  try {
    const s: any = (fs as any).statfsSync ? (fs as any).statfsSync(p) : null;
    if (!s) return null;
    const totalBytes = Number(s.blocks) * Number(s.bsize);
    const freeBytes = Number(s.bavail) * Number(s.bsize);
    return { path: p, totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
  } catch {
    return null;
  }
}

/**
 * 已迁移映射：sourcePath → { id, title, batchId, at }。
 * 拷贝式入库后源文件仍在源盘，下次扫描会再列出来；靠这张表把它们标为「已迁移」。
 */
export async function loadMigratedMap(): Promise<Record<string, { id: string; title: string; batchId: string; at: string }>> {
  const rows = await prisma.columnBook.findMany({
    where: { isDeleted: false, sourcePath: { not: '' } },
    select: { id: true, title: true, sourcePath: true, batchId: true, createdAt: true },
    take: 20000,
  });
  const map: Record<string, { id: string; title: string; batchId: string; at: string }> = {};
  for (const r of rows) {
    if (!r.sourcePath) continue;
    map[r.sourcePath] = { id: r.id, title: r.title, batchId: r.batchId, at: r.createdAt.toISOString() };
  }
  return map;
}

function findRepoRoot(): string {
  // ESM 下没有 __dirname，用 import.meta.url 推导当前文件所在目录
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'scripts', 'collect-scan.py'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function readJsonSafe(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 预分析预览：读取离线脚本产物
// ─────────────────────────────────────────────────────────────
router.get('/preview', asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const treePath = path.join(COLLECT_OUT, 'collect-tree.json');
  const filesPath = path.join(COLLECT_OUT, 'collect-files.json');

  const tree = readJsonSafe(treePath);
  const filesWrap = readJsonSafe(filesPath);

  if (!tree || !filesWrap) {
    return res.status(404).json({
      error: '尚未生成预分析结果',
      hint: '请先在服务端跑 scripts/collect-scan.py，或点页面上的「重新扫描」。',
      expectTree: treePath,
      expectFiles: filesPath,
    });
  }

  const migrated = await loadMigratedMap();

  res.json({
    data: {
      meta: filesWrap.meta,
      files: filesWrap.files,
      tree,
      migrated,
      paths: { tree: treePath, files: filesPath, src: COLLECT_SRC, out: COLLECT_OUT, target: COLUMN_ROOT },
    },
  });
}));

// ─────────────────────────────────────────────────────────────
// 重新扫描：跑 collect-scan.py（可选限定科目 / 跳过哈希）
// ─────────────────────────────────────────────────────────────
function runScan(src: string, out: string, opts: { subject?: string; noHash?: boolean }): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const py = process.env.PYTHON_BIN || 'python3';
    const script = path.join(findRepoRoot(), 'scripts', 'collect-scan.py');
    if (!fs.existsSync(script)) {
      return reject(new Error(`找不到扫描脚本: ${script}`));
    }
    const args = [script, src, '-o', out];
    if (opts.subject && opts.subject.trim()) args.push('--subject', opts.subject.trim());
    if (opts.noHash) args.push('--no-hash');

    const cp = spawn(py, args, { cwd: findRepoRoot() });
    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => { stdout += d.toString(); });
    cp.stderr.on('data', (d) => { stderr += d.toString(); });
    cp.on('error', (e) => reject(e));
    cp.on('close', (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(`扫描脚本退出码 ${code}\n${stderr || stdout}`.slice(0, 2000)));
    });
  });
}

router.post('/scan', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const subject = String(req.body?.subject || '').trim();
  const noHash = req.body?.noHash === true;

  // 源目录：默认走 env，允许前端在页面上临时指定（用于验证不同盘/子目录）
  const requestedSrc = String(req.body?.src || '').trim();
  const src = requestedSrc ? path.resolve(requestedSrc) : path.resolve(COLLECT_SRC);
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    return res.status(400).json({ error: '源目录不存在或不是目录', src });
  }

  try {
    const { stdout } = await runScan(src, COLLECT_OUT, { subject, noHash });
    // 重跑后顺手读回产物，省去前端再发一次请求
    const tree = readJsonSafe(path.join(COLLECT_OUT, 'collect-tree.json'));
    const filesWrap = readJsonSafe(path.join(COLLECT_OUT, 'collect-files.json'));
    const migrated = await loadMigratedMap();
    res.json({
      data: {
        ran: true,
        subject: subject || null,
        noHash,
        src: src,
        logTail: stdout.toString().split('\n').slice(-12).join('\n'),
        meta: filesWrap?.meta ?? null,
        files: filesWrap?.files ?? [],
        tree: tree ?? null,
        migrated,
        paths: { tree: path.join(COLLECT_OUT, 'collect-tree.json'), files: path.join(COLLECT_OUT, 'collect-files.json'), src, out: COLLECT_OUT, target: COLUMN_ROOT },
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: '扫描失败', detail: String(e?.message || e).slice(0, 2000) });
  }
}));

// ─────────────────────────────────────────────────────────────
// 入库（P3）：把预览页勾选 + 校正后的文件搬到目标盘并写入 column_book
//   mode='copy'（默认）保留源文件；mode='move' 搬运后删源（危险）
// ─────────────────────────────────────────────────────────────
router.post('/commit', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rawItems: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!rawItems.length) return res.status(400).json({ error: 'items required' });
  if (rawItems.length > 2000) return res.status(400).json({ error: 'too many items (max 2000)' });

  const targetRoot = String(req.body?.targetRoot || '').trim() || undefined;
  const batchId = String(req.body?.batchId || `column-${new Date().toISOString().slice(0, 10)}`).trim();
  const mode: 'copy' | 'move' = req.body?.mode === 'move' ? 'move' : 'copy';

  try {
    const result = await importColumnItems(
      rawItems.map((it) => ({
        filePath: String(it?.filePath || ''),
        title: it?.title ? String(it.title) : undefined,
        category: it?.category ? String(it.category) : undefined,
        subject: it?.subject ? String(it.subject) : undefined,
        grade: it?.grade ? String(it.grade) : undefined,
        series: it?.series ? String(it.series) : undefined,
        totalPages: it?.totalPages != null ? Number(it.totalPages) : undefined,
        searchable: it?.searchable ? String(it.searchable) : undefined,
        fileSize: it?.fileSize != null ? Number(it.fileSize) : undefined,
        fileHash: it?.fileHash != null ? String(it.fileHash) : undefined,
      })),
      { targetRoot, batchId, mode },
    );
    res.json({ data: result });
  } catch (e: any) {
    res.status(500).json({ error: '入库失败', detail: String(e?.message || e).slice(0, 2000) });
  }
}));

// ─────────────────────────────────────────────────────────────
// 磁盘空间：入库前预估目标盘剩余空间
// ─────────────────────────────────────────────────────────────
router.get('/disk', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = String(req.query?.path || '').trim();
  const target = p ? path.resolve(p) : COLUMN_ROOT;
  if (!fs.existsSync(target)) {
    return res.status(400).json({ error: '路径不存在', path: target });
  }
  const info = diskInfo(target);
  if (!info) return res.status(500).json({ error: '无法读取磁盘信息（statfs 不可用）', path: target });
  res.json({ data: info });
}));

// ─────────────────────────────────────────────────────────────
// 路径体积统计：删除前预估「几个文件 / 多大」
// ─────────────────────────────────────────────────────────────
router.post('/fs/stat', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rawPaths: any[] = Array.isArray(req.body?.paths) ? req.body.paths : [];
  if (!rawPaths.length) return res.status(400).json({ error: 'paths required' });
  if (rawPaths.length > 5000) return res.status(400).json({ error: 'too many paths (max 5000)' });

  const items = rawPaths.map((raw) => {
    const abs = path.resolve(String(raw || '').trim());
    if (!fs.existsSync(abs)) return { path: abs, exists: false, isDir: false, sizeBytes: 0, fileCount: 0, dirCount: 0 };
    const lst = fs.lstatSync(abs);
    if (lst.isDirectory()) {
      const r = statRecursive(abs);
      return { path: abs, exists: true, isDir: true, ...r };
    }
    return { path: abs, exists: true, isDir: false, sizeBytes: lst.size, fileCount: 1, dirCount: 0 };
  });

  res.json({
    data: {
      items,
      totalBytes: items.reduce((a, b) => a + b.sizeBytes, 0),
      totalFiles: items.reduce((a, b) => a + b.fileCount, 0),
      totalDirs: items.reduce((a, b) => a + b.dirCount, 0),
    },
  });
}));

/**
 * 批量物理删除（提供删除守卫）。路径必须严格位于白名单根目录之内。
 * 抽成独立函数便于复用与测试。
 */
export function deletePaths(rawPaths: string[]): {
  results: { path: string; ok: boolean; error?: string; sizeBytes?: number; fileCount?: number }[];
  okCount: number;
  failCount: number;
  freedBytes: number;
  deletedFiles: number;
} {
  const results: { path: string; ok: boolean; error?: string; sizeBytes?: number; fileCount?: number }[] = [];
  for (const raw of rawPaths) {
    const target = String(raw || '').trim();
    const g = guardDeletable(target);
    if (g.error) { results.push({ path: g.abs, ok: false, error: g.error }); continue; }
    try {
      const lst = fs.lstatSync(g.abs);
      let sizeBytes = 0;
      let fileCount = 0;
      if (lst.isDirectory()) {
        const st = statRecursive(g.abs);
        sizeBytes = st.sizeBytes;
        fileCount = st.fileCount;
        fs.rmSync(g.abs, { recursive: true, force: true });
      } else {
        sizeBytes = lst.size;
        fileCount = 1;
        fs.rmSync(g.abs, { force: true });
      }
      results.push({ path: g.abs, ok: true, sizeBytes, fileCount });
    } catch (e: any) {
      results.push({ path: g.abs, ok: false, error: String(e?.message || e).slice(0, 200) });
    }
  }
  const deleted = results.filter((r) => r.ok);
  return {
    results,
    okCount: deleted.length,
    failCount: results.length - deleted.length,
    freedBytes: deleted.reduce((a, b) => a + (b.sizeBytes || 0), 0),
    deletedFiles: deleted.reduce((a, b) => a + (b.fileCount || 0), 0),
  };
}

// ─────────────────────────────────────────────────────────────
// 批量物理删除（文件 / 文件夹）—— 严格限制在允许根目录内
// ─────────────────────────────────────────────────────────────
router.post('/fs/delete', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rawPaths: any[] = Array.isArray(req.body?.paths) ? req.body.paths : [];
  const echo: string = String(req.body?.echo || '').trim(); // 用户输入的回执短语，防误触
  if (!rawPaths.length) return res.status(400).json({ error: 'paths required' });
  if (rawPaths.length > 2000) return res.status(400).json({ error: 'too many paths (max 2000)' });
  if (echo !== 'DELETE') return res.status(400).json({ error: '缺少确认回执（echo=DELETE）' });

  res.json({ data: deletePaths(rawPaths.map((p) => String(p || ''))) });
}));

// ─────────────────────────────────────────────────────────────
// 一键清空：column_* 表 与 / 或 目标盘 PDF
// ─────────────────────────────────────────────────────────────
router.post('/purge', asyncHandler(async (req: AuthedRequest, res: Response) => {
  const echo: string = String(req.body?.echo || '').trim();
  if (echo !== 'PURGE') return res.status(400).json({ error: '缺少确认回执（echo=PURGE）' });

  const doDb = req.body?.db === true;
  const doFiles = req.body?.files === true;
  if (!doDb && !doFiles) return res.status(400).json({ error: '至少要选择清空数据库或目标盘文件' });

  const targetRoot = path.resolve(String(req.body?.targetRoot || '').trim() || COLUMN_ROOT);
  const filePattern: 'pdf' | 'all' = req.body?.filePattern === 'all' ? 'all' : 'pdf';

  const out: any = { db: null, files: null };

  // 1) 数据库：按外键依赖顺序删，最后删 column_book
  if (doDb) {
    const before = await prisma.columnBook.count();
    await prisma.columnAssignmentStroke.deleteMany({});
    await prisma.columnMistake.deleteMany({});
    await prisma.columnAnnotation.deleteMany({});
    await prisma.columnAssignment.deleteMany({});
    await prisma.columnReadingProgress.deleteMany({});
    await prisma.columnBookFavorite.deleteMany({});
    await prisma.columnThumb.deleteMany({});
    await prisma.columnPageText.deleteMany({});
    await prisma.columnVideo.deleteMany({});
    await prisma.columnBook.deleteMany({});
    const after = await prisma.columnBook.count();
    out.db = { booksBefore: before, booksAfter: after };
  }

  // 2) 目标盘文件：删除 *.pdf（或全部），并清理空目录
  if (doFiles) {
    if (!fs.existsSync(targetRoot)) {
      out.files = { skipped: true, reason: '目标根目录不存在', targetRoot };
    } else if (!(path.resolve(targetRoot) === path.resolve(COLUMN_ROOT) || isStrictlyInside(targetRoot, COLUMN_ROOT))) {
      // 清空文件只允许作用于专栏目标盘，避免误清源盘
      out.files = { skipped: true, reason: '目标根目录必须位于专栏目标盘之内', targetRoot, columnRoot: COLUMN_ROOT };
    } else {
      let deletedFiles = 0;
      let freedBytes = 0;
      const matched: string[] = [];
      const walk = (dir: string) => {
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full); continue; }
          if (!e.isFile()) continue;
          if (filePattern === 'pdf' && !e.name.toLowerCase().endsWith('.pdf')) continue;
          try {
            const sz = fs.lstatSync(full).size;
            fs.rmSync(full, { force: true });
            deletedFiles++;
            freedBytes += sz;
            if (matched.length < 50) matched.push(full);
          } catch { /* 单个失败不阻断 */ }
        }
      };
      walk(targetRoot);

      // 清理空目录（自底向上；保留根目录本身）
      let prunedDirs = 0;
      const prune = (dir: string) => {
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) if (e.isDirectory()) prune(path.join(dir, e.name));
        if (path.resolve(dir) === targetRoot) return;
        try {
          if (fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); prunedDirs++; }
        } catch { /* ignore */ }
      };
      prune(targetRoot);

      out.files = { targetRoot, filePattern, deletedFiles, freedBytes, prunedDirs, sample: matched };
    }
  }

  res.json({ data: out });
}));

export default router;
