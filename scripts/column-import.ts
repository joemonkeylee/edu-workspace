/**
 * 专栏 PDF 入库：实跑脚本（配合 tsx 运行）。
 *
 * 用法：
 *   tsx scripts/column-import.ts <科目> [limit] [outDir] [mode] [offset]
 *
 *   mode:   copy（默认，保留源文件） | move（搬运后删源，危险）
 *   offset: 从候选列表第 N 个开始取（跳过已入库的，用来自定义试批范围）
 *
 * 读取 collect-files.json（默认 /tmp/pdf-collect-math），筛选指定科目、非排除项，
 * 调用 server 的 importColumnItems 把文件搬到目标盘并写入 column_book（+ 关联 mp4）。
 *
 * 幂等：重复运行会因 sourcePath / fileHash / (rootPath, relPath) 去重而跳过，安全。
 */
import fs from 'fs';
import path from 'path';
import { importColumnItems } from '../server/src/pdf/services/columnImport';

async function main() {
  const subject = process.argv[2] || '数学';
  const limit = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
  const out = process.argv[4] || process.env.COLLECT_OUT || '/tmp/pdf-collect-math';
  const mode = process.argv[5] === 'move' ? 'move' : 'copy';
  const offset = process.argv[6] ? parseInt(process.argv[6], 10) : 0;

  const wrap = JSON.parse(fs.readFileSync(path.join(out, 'collect-files.json'), 'utf-8'));
  const files: any[] = wrap.files;

  const all = files
    .filter((f: any) => f.kind === 'pdf' && !f.noise && f.subject === subject);

  // 只挑源文件仍存在的（move 模式下已搬走的会不存在）
  const existing = all.filter((f: any) => { try { return fs.statSync(f.absPath).isFile(); } catch { return false; } });

  let items = existing.map((f: any) => ({
    filePath: f.absPath,
    title: f.name.replace(/\.pdf$/i, ''),
    category: f.dir ? path.basename(f.dir) : '',
    subject: f.subject,
    grade: f.grade,
    series: f.series,
    fileSize: Math.round(f.sizeMB * 1024 * 1024),
    fileHash: f.sha256 || null,
  }));

  if (offset) items = items.slice(offset);
  if (limit) items = items.slice(0, limit);

  console.log(`[column-import] 科目=${subject} mode=${mode} 候选=${all.length} 源存在=${existing.length} offset=${offset} 待入库=${items.length} (from ${out})`);
  if (!items.length) { console.log('[column-import] 无可入库文件，退出'); return; }

  const r = await importColumnItems(items, {
    targetRoot: process.env.COLUMN_PDF_ROOT || '/Volumes/COLORFUL256/source/pdf',
    batchId: `column-${subject}-${new Date().toISOString().slice(0, 10)}`,
    mode,
  });

  console.log(`[column-import] mode=${r.mode} created=${r.created.length} skipped=${r.skipped.length} videos=${r.videoCount}`);
  if (r.created.length) console.log('[column-import] 新建 id:', r.created.map((c) => c.id).join(','));
  if (r.skipped.length) console.log('[column-import] 跳过样本:', JSON.stringify(r.skipped.slice(0, 5), null, 2));

  // 复核：源文件是否仍在（copy 模式应全部保留）
  let srcKept = 0;
  for (const it of items) { try { if (fs.statSync(it.filePath).isFile()) srcKept++; } catch { /* gone */ } }
  console.log(`[column-import] 复核：源文件仍在 ${srcKept}/${items.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
