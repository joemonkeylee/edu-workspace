import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectPreview, collectScan, collectCommit, collectDisk, collectFsStat, collectFsDelete, collectPurge,
  type CollectFile, type CollectPreviewData, type CollectTreeNode, type DiskInfo,
} from '../../../pdf/api/pdfClient';
import { toast } from 'sonner';
import { useConfirm } from '../../ConfirmDialog';
import {
  FolderTree, RefreshCw, Search, Folder, ChevronRight, ChevronDown,
  Download, AlertTriangle, EyeOff, Eye, Trash2, HardDrive, CheckCircle2, Copy, Scissors,
} from 'lucide-react';

const GRADE_PRESETS = ['七上', '七下', '八上', '八下', '九上', '九下', '七年级', '八年级', '九年级', '中考', '初中通用'];

// 范围（扫描科目）可选项
const SCOPE_OPTIONS = ['', '语文', '数学', '英语', '物理', '化学', '生物', '地理', '历史', '政治', '科学', '中考'];

// 源目录快捷选项（验证不同盘用）
const SRC_PRESETS = [
  '/Volumes/WD10JPVT-75/资料',
  '/Volumes/COLORFUL256/source/pdf',
];

type Override = { subject?: string; grade?: string; series?: string };
type MigratedMap = Record<string, { id: string; title: string; batchId: string; at: string }>;

function confClass(conf: number): string {
  if (conf >= 0.9) return 'text-green-600 dark:text-green-400';
  if (conf >= 0.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

function fmtBytes(n: number): string {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 || v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** POSIX 路径拼接（浏览器端没有 path 模块） */
function joinPath(root: string, rel: string): string {
  const r = String(root || '').replace(/\/+$/, '');
  const s = String(rel || '').replace(/^\/+/, '');
  return s ? `${r}/${s}` : r;
}

export default function PdfCollectPreview() {
  const confirm = useConfirm();

  const [data, setData] = useState<CollectPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  // 树导航 / 筛选
  const [selectedDir, setSelectedDir] = useState('');
  const [dirFilter, setDirFilter] = useState<Set<string>>(new Set()); // 目录树勾选（过滤；也用于「删除勾选目录」）
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [subjectFilter, setSubjectFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [hideNoise, setHideNoise] = useState(false);
  const [onlyUnmigrated, setOnlyUnmigrated] = useState(false);
  const [search, setSearch] = useState('');

  // 选择 + 覆盖（会话内，用于校正解析结果）
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [batchSubject, setBatchSubject] = useState('');
  const [batchGrade, setBatchGrade] = useState('');
  const [batchSeries, setBatchSeries] = useState('');

  // 扫描设置（源 / 范围，可编辑以便验证不同盘/科目）
  const [scanSource, setScanSource] = useState('');
  const [scanSubject, setScanSubject] = useState('');
  const srcInit = useRef(false);

  // 入库 / 删除 / 清空
  const [committing, setCommitting] = useState(false);
  const [moveMode, setMoveMode] = useState(false); // false = 拷贝（默认，安全）
  const [deleting, setDeleting] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeDb, setPurgeDb] = useState(true);
  const [purgeFiles, setPurgeFiles] = useState(true);
  const [disk, setDisk] = useState<DiskInfo | null>(null);

  const migrated: MigratedMap = useMemo(() => data?.migrated || {}, [data]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await collectPreview();
      setData(d);
      // 仅首次加载时把「源」填入输入框，之后刷新不覆盖用户手动编辑
      if (!srcInit.current && d.paths?.src) {
        setScanSource(d.paths.src);
        srcInit.current = true;
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '加载失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 目标盘剩余空间（入库预估用）
  const targetPath = data?.paths?.target || '';
  useEffect(() => {
    if (!targetPath) { setDisk(null); return; }
    let alive = true;
    collectDisk(targetPath)
      .then((d) => { if (alive) setDisk(d); })
      .catch(() => { if (alive) setDisk(null); });
    return () => { alive = false; };
  }, [targetPath]);

  const handleRescan = useCallback(async () => {
    if (!scanSource.trim()) { toast.error('请先填写源目录'); return; }
    setScanning(true);
    try {
      const d = await collectScan({ src: scanSource.trim(), subject: scanSubject || undefined, noHash: true });
      setData(d);
      if (d.paths?.src) setScanSource(d.paths.src);
      setDirFilter(new Set());
      setSelectedDir('');
      toast.success('重新扫描完成');
    } catch (e: any) {
      toast.error('扫描失败: ' + (e?.response?.data?.detail || e?.message || ''));
    } finally {
      setScanning(false);
    }
  }, [scanSource, scanSubject]);

  // ── 目录范围：勾选的目录优先，否则用「点选的单个目录」 ──
  const dirScopes = useMemo(
    () => (dirFilter.size > 0 ? Array.from(dirFilter) : (selectedDir ? [selectedDir] : [])),
    [dirFilter, selectedDir],
  );

  const inScope = useCallback(
    (f: CollectFile) => dirScopes.length === 0 || dirScopes.some((d) => f.dir === d || f.dir.startsWith(d + '/')),
    [dirScopes],
  );

  const dirFiles = useMemo(() => (data ? data.files.filter(inScope) : []), [data, inScope]);

  const filtered = useMemo(() => {
    return dirFiles.filter((f) => {
      if (hideNoise && f.noise) return false;
      if (onlyUnmigrated && migrated[f.absPath]) return false;
      if (subjectFilter && f.subject !== subjectFilter) return false;
      if (gradeFilter && f.grade !== gradeFilter) return false;
      if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [dirFiles, hideNoise, onlyUnmigrated, migrated, subjectFilter, gradeFilter, search]);

  const eff = useCallback((f: CollectFile): CollectFile => {
    const o = overrides[f.relPath];
    if (!o) return f;
    return {
      ...f,
      subject: o.subject ?? f.subject,
      grade: o.grade ?? f.grade,
      series: o.series ?? f.series,
    };
  }, [overrides]);

  const subjectOptions = useMemo(() => {
    const s = new Set<string>(Object.keys(data?.meta?.subjectDist || {}));
    return ['', ...Array.from(s)];
  }, [data]);
  const gradeOptions = useMemo(() => {
    const g = new Set<string>(Object.keys(data?.meta?.gradeDist || {}));
    GRADE_PRESETS.forEach((p) => g.add(p));
    return ['', ...Array.from(g)];
  }, [data]);
  const seriesOptions = useMemo(() => {
    const c = new Map<string, number>();
    (data?.files || []).forEach((f) => { if (f.series) c.set(f.series, (c.get(f.series) || 0) + 1); });
    return ['', ...Array.from(c.entries()).sort((a, b) => b[1] - a[1]).map((e) => e[0])];
  }, [data]);

  const toggleExpand = (rel: string) =>
    setExpanded((prev) => { const n = new Set(prev); if (n.has(rel)) n.delete(rel); else n.add(rel); return n; });

  const toggleSelect = (rel: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(rel)) n.delete(rel); else n.add(rel); return n; });

  const toggleDirCheck = (rel: string) => {
    setDirFilter((prev) => {
      // 若已有祖先目录被勾选，则该目录是被包含的，取消勾选需先去掉祖先
      const hasCheckedAncestor = Array.from(prev).some((d) => rel.startsWith(d + '/'));
      const n = new Set<string>();
      if (hasCheckedAncestor) {
        Array.from(prev).forEach((d) => { if (!(d === rel || rel.startsWith(d + '/'))) n.add(d); });
        return n;
      }
      if (prev.has(rel)) n.add(rel);
      else {
        // 勾选当前目录：移除其子孙（父级覆盖子级）
        Array.from(prev).forEach((d) => { if (!(d === rel || d.startsWith(rel + '/'))) n.add(d); });
        n.add(rel);
      }
      return n;
    });
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every((f) => selected.has(f.relPath));
  const toggleSelectAll = () =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (allVisibleSelected) filtered.forEach((f) => n.delete(f.relPath));
      else filtered.forEach((f) => n.add(f.relPath));
      return n;
    });

  const applyBatch = () => {
    if (selected.size === 0) { toast('请先勾选文件'); return; }
    const patch: Override = {};
    if (batchSubject) patch.subject = batchSubject;
    if (batchGrade) patch.grade = batchGrade;
    if (batchSeries) patch.series = batchSeries;
    if (Object.keys(patch).length === 0) { toast('请先选择要应用的科目/学期/系列'); return; }
    setOverrides((prev) => {
      const n = { ...prev };
      selected.forEach((rel) => { n[rel] = { ...n[rel], ...patch }; });
      return n;
    });
    toast.success(`已对 ${selected.size} 个文件应用覆盖（本次会话内）`);
  };

  const exportSelected = () => {
    if (selected.size === 0) { toast('请先勾选文件'); return; }
    const rows = (data?.files || [])
      .filter((f) => selected.has(f.relPath))
      .map((f) => { const e = eff(f); return { relPath: f.relPath, name: f.name, subject: e.subject, grade: e.grade, series: e.series, sizeMB: f.sizeMB, noise: f.noise, migrated: !!migrated[f.absPath] }; });
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pdf-collect-selection.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${rows.length} 条`);
  };

  // ── 入库预估 ──
  const estimate = useMemo(() => {
    const selFiles = (data?.files || []).filter((f) => selected.has(f.relPath));
    const clean = selFiles.filter((f) => !f.noise);
    const already = clean.filter((f) => migrated[f.absPath]);
    const fresh = clean.filter((f) => !migrated[f.absPath]);
    const bytes = fresh.reduce((a, f) => a + Math.round(f.sizeMB * 1024 * 1024), 0);
    return {
      selTotal: selFiles.length,
      excluded: selFiles.length - clean.length,
      already: already.length,
      fresh: fresh.length,
      bytes,
      notEnough: !!disk && bytes > disk.freeBytes,
    };
  }, [data, selected, migrated, disk]);

  const selFilesAbs = useMemo(
    () => (data?.files || []).filter((f) => selected.has(f.relPath)).map((f) => f.absPath),
    [data, selected],
  );
  const checkedDirAbs = useMemo(() => {
    const root = data?.meta?.root || data?.paths?.src || '';
    return Array.from(dirFilter).map((d) => joinPath(root, d));
  }, [data, dirFilter]);

  const handleCommit = useCallback(async () => {
    if (estimate.fresh === 0) { toast('勾选项里没有待入库（非排除、未迁移）的文件'); return; }
    const mode: 'copy' | 'move' = moveMode ? 'move' : 'copy';
    const ok = await confirm({
      title: mode === 'move' ? '⚠️ 剪切式入库（会删除源文件）' : '确认拷贝入库',
      message: mode === 'move'
        ? `将把 ${estimate.fresh} 个 PDF（${fmtBytes(estimate.bytes)}）复制到目标盘，成功后删除源盘原文件。\n此操作不可撤销，请确认已了解风险。`
        : `将把 ${estimate.fresh} 个 PDF（${fmtBytes(estimate.bytes)}）复制到目标盘并写入专栏库。\n源盘原文件会保留。`,
      confirmText: mode === 'move' ? '剪切并入库' : '拷贝并入库',
      confirmClass: mode === 'move' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-emerald-600 text-white hover:bg-emerald-700',
    });
    if (!ok) return;

    const items = (data?.files || [])
      .filter((f) => selected.has(f.relPath) && !f.noise && !migrated[f.absPath])
      .map((f) => {
        const e = eff(f);
        return {
          filePath: f.absPath,
          title: f.name.replace(/\.pdf$/i, ''),
          category: f.dir ? f.dir.split('/').pop() : '',
          subject: e.subject || undefined,
          grade: e.grade || undefined,
          series: e.series || undefined,
          fileSize: Math.round(f.sizeMB * 1024 * 1024),
          fileHash: f.sha256 || null,
        };
      });

    setCommitting(true);
    try {
      const r = await collectCommit({ items, mode });
      toast.success(`入库完成（${r.mode === 'move' ? '剪切' : '拷贝'}）：新建 ${r.created.length} 本，跳过 ${r.skipped.length} 个，关联视频 ${r.videoCount} 个`);
      if (r.skipped.length > 0) console.warn('[column-commit] skipped:', r.skipped);
      await load();
      setSelected(new Set());
    } catch (e: any) {
      toast.error('入库失败: ' + (e?.response?.data?.detail || e?.message || ''));
    } finally {
      setCommitting(false);
    }
  }, [data, selected, migrated, estimate, eff, moveMode, confirm, load]);

  // ── 物理删除（文件 / 目录） ──
  const doDelete = useCallback(async (paths: string[], label: string) => {
    if (paths.length === 0) { toast('没有可删除的目标'); return; }
    let stat;
    try {
      stat = await collectFsStat(paths);
    } catch (e: any) {
      toast.error('统计失败: ' + (e?.response?.data?.error || e?.message || ''));
      return;
    }
    const missing = stat.items.filter((i) => !i.exists).length;
    const preview = stat.items.slice(0, 8).map((i) => i.path).join('\n');
    const more = stat.items.length > 8 ? `\n… 其余 ${stat.items.length - 8} 项` : '';
    const ok = await confirm({
      title: `⚠️ 物理删除${label}`,
      message: `将从磁盘永久删除 ${stat.items.length} 个目标（${stat.totalFiles} 个文件，${fmtBytes(stat.totalBytes)}）${missing ? `，其中 ${missing} 个不存在` : ''}。\n\n${preview}${more}\n\n此操作不可撤销。`,
      confirmText: '永久删除',
      confirmClass: 'bg-red-600 text-white hover:bg-red-700',
    });
    if (!ok) return;

    setDeleting(true);
    try {
      const r = await collectFsDelete(paths);
      if (r.failCount > 0) {
        const firstErr = r.results.find((x) => !x.ok);
        toast.error(`删除完成：成功 ${r.okCount}，失败 ${r.failCount}（${firstErr?.error || ''}）`);
      } else {
        toast.success(`已删除 ${r.okCount} 个目标 / ${r.deletedFiles} 个文件，释放 ${fmtBytes(r.freedBytes)}`);
      }
      setSelected(new Set());
      setDirFilter(new Set());
      await load();
    } catch (e: any) {
      toast.error('删除失败: ' + (e?.response?.data?.error || e?.message || ''));
    } finally {
      setDeleting(false);
    }
  }, [confirm, load]);

  // ── 一键清空 ──
  const handlePurge = useCallback(async () => {
    if (!purgeDb && !purgeFiles) { toast('请至少选择「清空专栏库」或「删除目标盘 PDF」'); return; }
    const parts: string[] = [];
    if (purgeDb) parts.push('清空 column_* 全部表数据');
    if (purgeFiles) parts.push(`删除目标盘 ${targetPath} 下的全部 PDF（含生成的目录）`);
    const ok = await confirm({
      title: '⚠️ 一键清空',
      message: `将执行：\n· ${parts.join('\n· ')}\n\n此操作不可撤销，请确认。`,
      confirmText: '确认清空',
      confirmClass: 'bg-red-600 text-white hover:bg-red-700',
    });
    if (!ok) return;

    setPurging(true);
    try {
      const r = await collectPurge({ db: purgeDb, files: purgeFiles, targetRoot: targetPath, filePattern: 'pdf' });
      const bits: string[] = [];
      if (r.db) bits.push(`库：${r.db.booksBefore} → ${r.db.booksAfter} 本`);
      if (r.files && !('skipped' in r.files)) bits.push(`文件：删除 ${r.files.deletedFiles} 个 / 释放 ${fmtBytes(r.files.freedBytes)} / 清理空目录 ${r.files.prunedDirs} 个`);
      else if (r.files && 'skipped' in r.files) bits.push(`文件：已跳过（${r.files.reason}）`);
      toast.success('清空完成 —— ' + bits.join('；'));
      setSelected(new Set());
      setDirFilter(new Set());
      await load();
    } catch (e: any) {
      toast.error('清空失败: ' + (e?.response?.data?.error || e?.message || ''));
    } finally {
      setPurging(false);
    }
  }, [purgeDb, purgeFiles, targetPath, confirm, load]);

  // ── 渲染 ──
  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">加载预分析结果…</div>;
  }
  if (error && !data) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-background rounded-lg shadow p-6 text-sm">
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-2">
            <AlertTriangle size={18} /> 未能加载预分析结果
          </div>
          <p className="text-muted-foreground mb-3">{error}</p>
          <p className="text-xs text-muted-foreground mb-4">
            可在服务端运行 <code className="bg-muted px-1 rounded">scripts/collect-scan.py</code>，
            或点下方「重新扫描」。
          </p>
          <button onClick={handleRescan} disabled={scanning}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm">
            <RefreshCw size={16} className={scanning ? 'animate-spin' : ''} /> {scanning ? '扫描中…' : '重新扫描（快扫·不读内容）'}
          </button>
        </div>
      </div>
    );
  }

  const meta = data!.meta;
  const cleanCount = data!.files.filter((f) => f.kind === 'pdf' && !f.noise).length;
  const noiseCount = data!.files.filter((f) => f.kind === 'pdf' && f.noise).length;
  const migratedCount = data!.files.filter((f) => migrated[f.absPath]).length;
  const freshEstim = estimate.bytes;

  return (
    <div className="p-6">
      {/* 概览 */}
      <div className="bg-background rounded-lg shadow p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FolderTree size={18} /> PDF 专栏 · 预分析预览
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load}
              className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-input hover:bg-muted transition">
              <RefreshCw size={13} /> 刷新
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-muted-foreground">
          <span>扫描于 <span className="text-foreground">{meta?.scannedAt}</span></span>
          <span>真实 PDF <span className="text-foreground">{meta?.pdfCount}</span></span>
          <span>可入库 <span className="text-green-600 dark:text-green-400 font-medium">{cleanCount}</span></span>
          <span>排除 <span className="text-destructive font-medium">{noiseCount}</span></span>
          <span>已迁移 <span className="text-sky-600 dark:text-sky-400 font-medium">{migratedCount}</span></span>
          <span>重复组 <span className="text-foreground">{meta?.dupGroups}</span></span>
          <span>哈希 <span className="text-foreground">{meta?.hashed ? '是' : '否（快扫）'}</span></span>
          <span>上次范围 <span className="text-foreground">{meta?.subjectFilter || '全部科目'}</span></span>
          <span className="flex items-center gap-1">
            <HardDrive size={12} /> 目标盘剩余{' '}
            <span className="text-foreground">{disk ? fmtBytes(disk.freeBytes) : '（读取失败）'}</span>
            {disk && <span className="text-muted-foreground/70">/ {fmtBytes(disk.totalBytes)}</span>}
          </span>
        </div>
        {data!.paths && (
          <div className="mt-1 text-[11px] text-muted-foreground/70 break-all">
            源：{data!.paths.src} ｜ 目标：{targetPath} ｜ 产物：{data!.paths.out}
          </div>
        )}
      </div>

      {/* 扫描设置：源 / 范围 可编辑，便于验证不同盘与科目 */}
      <div className="bg-background rounded-lg shadow p-3 mb-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground mb-2">
          <FolderTree size={14} /> 扫描设置
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <div className="flex flex-col gap-1 min-w-0">
            <label className="text-[11px] text-muted-foreground">源目录</label>
            <input
              value={scanSource}
              onChange={(e) => setScanSource(e.target.value)}
              placeholder="扫描根目录（绝对路径）"
              className="px-2 py-1.5 border border-input rounded text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary w-[380px] max-w-full font-mono"
            />
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {SRC_PRESETS.map((p) => (
                <button key={p} onClick={() => setScanSource(p)}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-input text-muted-foreground hover:bg-muted transition">
                  {p.replace('/Volumes/', '')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">范围（科目）</label>
            <select
              value={scanSubject}
              onChange={(e) => setScanSubject(e.target.value)}
              className="px-2 py-1.5 border border-input rounded text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {SCOPE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === '' ? '全部科目' : s}</option>
              ))}
            </select>
          </div>
          <button onClick={handleRescan} disabled={scanning}
            className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-border transition whitespace-nowrap">
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            {scanning ? '扫描中…' : '重新扫描'}
          </button>
          <span className="text-[11px] text-muted-foreground self-end pb-1">将扫描：{scanSource || '（未填）'} · {scanSubject || '全部科目'}</span>
        </div>
      </div>

      {/* 入库预估 + 批量赋值 */}
      <div className="bg-background rounded-lg shadow p-3 mb-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground mb-2">
          <CheckCircle2 size={14} /> 入库预估与操作
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="已勾选" value={`${estimate.selTotal} 个`} sub={`排除 ${estimate.excluded} · 已迁移 ${estimate.already}`} />
          <Stat label="待入库" value={`${estimate.fresh} 个`} sub="非排除且未迁移" accent="green" />
          <Stat label="预计占用" value={fmtBytes(freshEstim)} sub={`平均 ${estimate.fresh ? fmtBytes(freshEstim / estimate.fresh) : '—'}`} />
          <Stat
            label="目标盘迁移后剩余"
            value={disk ? fmtBytes(Math.max(0, disk.freeBytes - freshEstim)) : '—'}
            sub={disk ? (estimate.notEnough ? '空间不足！' : `可用 ${fmtBytes(disk.freeBytes)}`) : '未读取到磁盘信息'}
            accent={estimate.notEnough ? 'red' : undefined}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer text-muted-foreground">
            <input type="checkbox" checked={moveMode} onChange={(e) => setMoveMode(e.target.checked)} className="accent-red-600" />
            <Scissors size={12} /> 剪切（删除源文件，危险）
          </label>
          <span className="text-muted-foreground/60">默认拷贝，源盘原文件保留</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={batchSubject} onChange={(e) => setBatchSubject(e.target.value)}
              className="px-1.5 py-1 border border-input rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary">
              {subjectOptions.map((s) => <option key={s} value={s}>{s || '科目…'}</option>)}
            </select>
            <select value={batchGrade} onChange={(e) => setBatchGrade(e.target.value)}
              className="px-1.5 py-1 border border-input rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary">
              {gradeOptions.map((g) => <option key={g} value={g}>{g || '学期…'}</option>)}
            </select>
            <select value={batchSeries} onChange={(e) => setBatchSeries(e.target.value)}
              className="px-1.5 py-1 border border-input rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary max-w-[140px]">
              {seriesOptions.map((s) => <option key={s} value={s}>{s || '系列…'}</option>)}
            </select>
            <button onClick={applyBatch}
              className="px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition whitespace-nowrap">
              应用到选中
            </button>
            <button onClick={exportSelected}
              className="flex items-center gap-1 px-2.5 py-1 rounded border border-input text-foreground/70 hover:bg-muted transition whitespace-nowrap">
              <Download size={13} /> 导出
            </button>
            <button onClick={handleCommit} disabled={committing || estimate.fresh === 0}
              className={[
                'flex items-center gap-1 px-3 py-1 rounded text-white transition whitespace-nowrap disabled:opacity-50',
                moveMode ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700',
              ].join(' ')}>
              {moveMode ? <Scissors size={13} /> : <Copy size={13} />}
              {committing ? '入库中…' : (moveMode ? `迁移入库（剪切 ${estimate.fresh}）` : `迁移入库（拷贝 ${estimate.fresh}）`)}
            </button>
          </div>
        </div>
        {estimate.notEnough && (
          <p className="text-xs text-destructive mt-2">
            ⚠️ 目标盘剩余空间不足（需要 {fmtBytes(freshEstim)}，仅有 {disk ? fmtBytes(disk.freeBytes) : '未知'}），请先清理或减少勾选。
          </p>
        )}
      </div>

      {/* 筛选条 */}
      <div className="bg-background rounded-lg shadow p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Search size={14} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜文件名"
            className="px-2 py-1 border border-input rounded text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary w-40" />
        </div>
        <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
          className="px-2 py-1 border border-input rounded text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary">
          {subjectOptions.map((s) => <option key={s} value={s}>{s || '全部科目'}</option>)}
        </select>
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}
          className="px-2 py-1 border border-input rounded text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary">
          {gradeOptions.map((g) => <option key={g} value={g}>{g || '全部学期'}</option>)}
        </select>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
          <input type="checkbox" checked={hideNoise} onChange={(e) => setHideNoise(e.target.checked)} className="accent-primary" />
          {hideNoise ? <EyeOff size={13} /> : <Eye size={13} />} 隐藏排除项
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyUnmigrated} onChange={(e) => setOnlyUnmigrated(e.target.checked)} className="accent-primary" />
          只看未迁移
        </label>
        {dirFilter.size > 0 && (
          <button onClick={() => setDirFilter(new Set())}
            className="text-xs px-2 py-0.5 rounded border border-sky-500/50 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 transition">
            已勾选目录 {dirFilter.size} 个 · 清除
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          范围 <span className="text-foreground">{dirScopes.length ? dirScopes.join(' + ') : '（全部）'}</span> · 命中 <span className="text-foreground">{filtered.length}</span> / {dirFiles.length}
        </span>
      </div>

      <div className="flex gap-4 items-start">
        {/* 目录树 */}
        <div className="w-80 flex-shrink-0 bg-background rounded-lg shadow p-2 max-h-[70vh] overflow-auto">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold text-foreground">目录树</span>
            <span className="text-[10px] text-muted-foreground">勾选=过滤范围</span>
          </div>
          <TreeView
            node={data!.tree}
            expanded={expanded}
            selectedDir={selectedDir}
            checked={dirFilter}
            implied={false}
            onToggleExpand={toggleExpand}
            onSelectDir={(rel) => { setSelectedDir(rel); setExpanded((p) => new Set(p).add(rel)); }}
            onToggleCheck={toggleDirCheck}
          />
        </div>

        {/* 文件表 */}
        <div className="flex-1 min-w-0 bg-background rounded-lg shadow overflow-hidden">
          {/* 批量工具条 */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="accent-primary" />
              全选
            </label>
            <span className="text-muted-foreground">已选 <span className="text-foreground">{selected.size}</span></span>
            <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}
              className="px-2 py-0.5 rounded border border-input text-muted-foreground hover:bg-muted transition disabled:opacity-40">
              清空勾选
            </button>
          </div>

          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="w-8 px-2 py-2"></th>
                  <th className="text-left px-2 py-2 font-medium text-foreground/70">文件名</th>
                  <th className="text-left px-2 py-2 font-medium text-foreground/70">科目</th>
                  <th className="text-left px-2 py-2 font-medium text-foreground/70">学期</th>
                  <th className="text-left px-2 py-2 font-medium text-foreground/70">系列</th>
                  <th className="text-left px-2 py-2 font-medium text-foreground/70">形态</th>
                  <th className="text-right px-2 py-2 font-medium text-foreground/70">大小</th>
                  <th className="text-left px-2 py-2 font-medium text-foreground/70">备注</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const e = eff(f);
                  const overridden = !!overrides[f.relPath];
                  const mig = migrated[f.absPath];
                  return (
                    <tr key={f.relPath} className={[
                      'border-b border-border/50',
                      f.noise ? 'bg-destructive/5' : '',
                      mig ? 'bg-sky-500/5' : '',
                      selected.has(f.relPath) ? 'bg-primary/5' : '',
                    ].join(' ')}>
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={selected.has(f.relPath)} onChange={() => toggleSelect(f.relPath)} className="accent-primary" />
                      </td>
                      <td className="px-2 py-1.5 text-foreground truncate max-w-[240px]" title={f.name}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{f.name.replace(/\.pdf$/i, '')}</span>
                          {mig && <span className="flex-shrink-0 text-[10px] px-1 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300" title={`已入库 id=${mig.id}（${mig.at}）`}>已迁移</span>}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {e.subject ? <span className="text-green-600 dark:text-green-400">{e.subject}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {e.grade ? <span className="text-primary">{e.grade}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {e.series
                          ? <span className={confClass(f.seriesConf)}>{e.series}{overridden && <span className="ml-1 text-[10px] text-amber-600">改</span>}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{e.docType || '—'}</td>
                      <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">{f.sizeMB.toFixed(1)}M</td>
                      <td className="px-2 py-1.5 text-xs">
                        {f.noise
                          ? <span className="text-destructive" title={f.noiseReason}>{f.noiseReason}</span>
                          : f.dupOf
                            ? <span className="text-amber-600 dark:text-amber-400" title={f.dupOf}>↺ 重复</span>
                            : <span className="text-muted-foreground/60">—</span>}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">无匹配文件</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 危险操作区 */}
      <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-destructive mb-3">
          <AlertTriangle size={16} /> 危险操作
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs mb-4">
          <span className="text-muted-foreground">物理删除：</span>
          <button
            onClick={() => doDelete(selFilesAbs, `选中的 ${selFilesAbs.length} 个文件`)}
            disabled={deleting || selFilesAbs.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-40">
            <Trash2 size={13} /> 删除选中文件（{selFilesAbs.length}）
          </button>
          <button
            onClick={() => doDelete(checkedDirAbs, `勾选的 ${checkedDirAbs.length} 个目录（含其全部内容）`)}
            disabled={deleting || checkedDirAbs.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-40">
            <Trash2 size={13} /> 删除勾选目录（{checkedDirAbs.length}）
          </button>
          <span className="text-muted-foreground/70">删除前会先统计文件数与体积，并二次确认；仅允许删除白名单根目录（源盘 / 目标盘）之下的路径</span>
        </div>

        <div className="border-t border-destructive/20 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">一键清空：</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={purgeDb} onChange={(e) => setPurgeDb(e.target.checked)} className="accent-red-600" />
              清空 column_* 全部表
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={purgeFiles} onChange={(e) => setPurgeFiles(e.target.checked)} className="accent-red-600" />
              删除目标盘 PDF（{targetPath}）
            </label>
            <button onClick={handlePurge} disabled={purging || (!purgeDb && !purgeFiles)}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-red-700 text-white hover:bg-red-800 transition disabled:opacity-40">
              <Trash2 size={13} /> {purging ? '清空中…' : '一键清空'}
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        提示：目录树里 <span className="text-destructive">红点</span> 表示该目录含排除项（小升初/字帖/高中等）；
        <span className="text-sky-600 dark:text-sky-400">已迁移</span> 表示该源文件此前已拷入专栏（拷贝模式下源文件仍在，重复入库会自动跳过）；
        「应用到选中」的覆盖仅在本会话内、用于校正解析结果；<span className="text-emerald-600 dark:text-emerald-400">迁移入库（拷贝）</span> 默认保留源文件，
        勾选「剪切」才会删除源文件。
      </p>
    </div>
  );
}

// ── 小统计块 ──
function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: 'green' | 'red' }) {
  const color = accent === 'green' ? 'text-emerald-600 dark:text-emerald-400'
    : accent === 'red' ? 'text-destructive'
      : 'text-foreground';
  return (
    <div className="rounded border border-border/60 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}

// ── 目录树递归渲染（带勾选框，用于过滤 / 删除选择） ──
function TreeView({ node, expanded, selectedDir, checked, implied, onToggleExpand, onSelectDir, onToggleCheck }: {
  node: CollectTreeNode;
  expanded: Set<string>;
  selectedDir: string;
  checked: Set<string>;
  implied: boolean;
  onToggleExpand: (rel: string) => void;
  onSelectDir: (rel: string) => void;
  onToggleCheck: (rel: string) => void;
}) {
  const isRoot = node.relPath === '';
  const isOpen = expanded.has(node.relPath);
  const isSel = selectedDir === node.relPath;
  // 根节点直接渲染子节点（不显示自己）
  if (isRoot) {
    return (
      <div>
        {node.children.map((c) => (
          <TreeView key={c.relPath} node={c} expanded={expanded} selectedDir={selectedDir} checked={checked}
            implied={false} onToggleExpand={onToggleExpand} onSelectDir={onSelectDir} onToggleCheck={onToggleCheck} />
        ))}
      </div>
    );
  }

  const selfChecked = checked.has(node.relPath);
  const isChecked = implied || selfChecked;
  const boxDisabled = implied; // 祖先已勾选，子级被覆盖
  const isDeleteTarget = selfChecked && !implied;

  return (
    <div>
      <div className={[
        'flex items-center gap-1 px-1 py-1 rounded cursor-pointer text-sm',
        isSel ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60 text-foreground/80',
        isDeleteTarget ? 'ring-1 ring-red-500/40' : '',
      ].join(' ')}>
        <input
          type="checkbox"
          checked={isChecked}
          disabled={boxDisabled}
          onChange={() => onToggleCheck(node.relPath)}
          onClick={(e) => e.stopPropagation()}
          className="accent-primary flex-shrink-0"
          title={boxDisabled ? '已被上层勾选覆盖' : '勾选：只看该目录（也可用于批量删除目录）'}
        />
        <button onClick={() => onToggleExpand(node.relPath)} className="flex-shrink-0 text-muted-foreground hover:text-foreground">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span onClick={() => onSelectDir(node.relPath)} className="flex items-center gap-1.5 min-w-0 flex-1">
          <Folder size={13} className="flex-shrink-0 text-muted-foreground" />
          <span className="truncate flex-1">{node.name}</span>
          {node.hasNoise && <span className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" title="含排除项" />}
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{node.fileCount}</span>
        </span>
      </div>
      {isOpen && node.children.length > 0 && (
        <div className="ml-3 border-l border-border/60 pl-1">
          {node.children.map((c) => (
            <TreeView key={c.relPath} node={c} expanded={expanded} selectedDir={selectedDir} checked={checked}
              implied={isChecked} onToggleExpand={onToggleExpand} onSelectDir={onSelectDir} onToggleCheck={onToggleCheck} />
          ))}
        </div>
      )}
    </div>
  );
}
