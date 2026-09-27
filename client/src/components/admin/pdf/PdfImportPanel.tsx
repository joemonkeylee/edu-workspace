import { useState, useCallback } from 'react';
import { Scan, FolderOpen, Check, AlertTriangle, RefreshCw, Database, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../../ConfirmDialog';
import { scanPreview, scanCommit, seedFromBooks, recheckSearchable } from '../../../pdf/api/pdfClient';

interface ScanItem {
  filePath: string;
  fileName: string;
  title: string;
  relPath: string;
  rootPath: string;
  category: string;
  grade: string | null;
  subject: string | null;
  totalPages: number;
  searchable: string;
  fileSize: number;
  fileHash: string | null;
  legacyBookId: number | null;
  legacyTitle: string | null;
  alreadyImported: boolean;
  existingPdfBookId: number | null;
  error: string | null;
}

const SEARCHABLE_LABEL: Record<string, string> = {
  ok: '可搜索',
  no_text: '无文本',
  garbled: '乱码',
  watermark_only: '仅水印',
};

export default function PdfImportPanel() {
  const confirm = useConfirm();
  const [rootPath, setRootPath] = useState('');
  const [recursive, setRecursive] = useState(true);
  const [doHash, setDoHash] = useState(true);
  const [batchId, setBatchId] = useState('');
  const [generateCovers, setGenerateCovers] = useState(true);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState<{ total: number; alreadyImported: number; matchLegacy: number; unscannable: number; errored: number } | null>(null);

  // 播种
  const [seedLimit, setSeedLimit] = useState(5000);
  const [seedResult, setSeedResult] = useState<any>(null);
  const [seeding, setSeeding] = useState(false);

  const handlePreview = useCallback(async () => {
    if (!rootPath.trim()) return;
    setPreviewing(true);
    setItems([]);
    setSummary(null);
    try {
      const res: any = await scanPreview({ rootPath: rootPath.trim(), recursive, max: 500, hash: doHash });
      setItems(res.items);
      setSummary(res.summary);
      toast.success(`预解析完成：${res.scanned} 个文件`);
    } catch (e: any) {
      toast.error('预解析失败: ' + (e?.message || ''));
    } finally {
      setPreviewing(false);
    }
  }, [rootPath, recursive, doHash]);

  const toggleSelect = (fp: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const selectAllNew = () => {
    const next = new Set<string>();
    items.forEach((it) => {
      if (!it.alreadyImported && !it.error) next.add(it.filePath);
    });
    setSelected(next);
  };

  const clearSelection = () => setSelected(new Set());

  const handleCommit = async () => {
    if (selected.size === 0) {
      toast.error('请勾选要入库的文件');
      return;
    }
    const ok = await confirm({
      title: '确认入库',
      message: `将入库 ${selected.size} 个 PDF 到 pdf_book 表${generateCovers ? '（并生成封面）' : ''}。此操作不影响图片版书籍。`,
      confirmText: '确认入库',
      confirmClass: 'bg-primary text-primary-foreground hover:bg-primary/90',
    });
    if (!ok) return;

    setCommitting(true);
    try {
      const selectedItems = items.filter((it) => selected.has(it.filePath));
      const res: any = await scanCommit({
        items: selectedItems,
        batchId: batchId.trim() || undefined,
        generateCovers,
      });
      toast.success(`入库完成：成功 ${res.created} 本，跳过 ${res.skipped.length} 本`);
      setItems((prev) => prev.filter((it) => !selected.has(it.filePath)));
      clearSelection();
    } catch (e: any) {
      toast.error('入库失败: ' + (e?.message || ''));
    } finally {
      setCommitting(false);
    }
  };

  const handleSeedDryRun = async () => {
    try {
      const res: any = await seedFromBooks({ dryRun: true, limit: seedLimit, generateCovers: false });
      setSeedResult(res);
      toast.info(`dry-run：候选 ${res.candidates} 本，待创建 ${res.toCreate} 本`);
    } catch (e: any) {
      toast.error('dry-run 失败: ' + (e?.message || ''));
    }
  };

  const handleSeedCommit = async () => {
    const ok = await confirm({
      title: '确认从旧库播种',
      message: '将把既有 Book 表中有 PDF 原件的书以元数据形式播种到 pdf_book（只读旧库，不修改图片版数据）。',
      confirmText: '确认播种',
      confirmClass: 'bg-primary text-primary-foreground hover:bg-primary/90',
    });
    if (!ok) return;
    setSeeding(true);
    try {
      const res: any = await seedFromBooks({ dryRun: false, limit: seedLimit, generateCovers: false });
      toast.success(`播种完成：创建 ${res.created} 本，跳过 ${res.skipped} 本`);
      setSeedResult(res);
    } catch (e: any) {
      toast.error('播种失败: ' + (e?.message || ''));
    } finally {
      setSeeding(false);
    }
  };

  const handleRecheck = async () => {
    try {
      const res: any = await recheckSearchable(50);
      toast.success(`复查完成：检查 ${res.examined} 本，更新 ${res.updated} 本`);
    } catch (e: any) {
      toast.error('复查失败: ' + (e?.message || ''));
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 扫描入库 */}
      <div className="bg-background rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
          <Scan size={20} className="text-primary" /> 扫描目录入库
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">本地目录绝对路径</label>
            <div className="relative">
              <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <input
                type="text"
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder="/Users/username/Documents/textbooks"
                className="w-full pl-10 pr-4 py-2.5 border border-input bg-background text-foreground placeholder:text-muted-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={previewing || committing}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} className="w-4 h-4 accent-primary" disabled={previewing} />
              <span className="text-sm text-foreground">递归子目录</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={doHash} onChange={(e) => setDoHash(e.target.checked)} className="w-4 h-4 accent-primary" disabled={previewing} />
              <span className="text-sm text-foreground">计算哈希（查重）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={generateCovers} onChange={(e) => setGenerateCovers(e.target.checked)} className="w-4 h-4 accent-primary" />
              <span className="text-sm text-foreground">生成封面</span>
            </label>
            <input
              type="text"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              placeholder="批次号（可选）"
              className="px-3 py-2 border border-input bg-background text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handlePreview}
              disabled={previewing || !rootPath.trim()}
              className="inline-flex items-center gap-2 bg-muted hover:bg-muted disabled:opacity-50 text-foreground px-4 py-2 rounded-lg text-sm font-medium"
            >
              {previewing ? '解析中...' : '预解析'}
            </button>
            <button
              onClick={handleCommit}
              disabled={committing || selected.size === 0}
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium"
            >
              {committing ? '入库中...' : `入库选中 (${selected.size})`}
            </button>
          </div>
        </div>

        {/* 预解析结果 */}
        {items.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                预解析结果（{items.length} 个文件）
                {summary && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    已入库 {summary.alreadyImported} · 匹配旧库 {summary.matchLegacy} · 无文本 {summary.unscannable} · 错误 {summary.errored}
                  </span>
                )}
              </span>
              <div className="flex gap-2">
                <button onClick={selectAllNew} className="text-xs text-primary hover:underline">全选未入库</button>
                <button onClick={clearSelection} className="text-xs text-muted-foreground hover:underline">清空选择</button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="text-left px-3 py-2 font-medium text-foreground/70">文件名</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground/70">标题</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground/70">学期</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground/70">学科</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground/70">页数</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground/70">可搜索</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground/70">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const isSelected = selected.has(it.filePath);
                    const disabled = it.alreadyImported || !!it.error;
                    return (
                      <tr key={it.filePath} className={`border-t border-border ${isSelected ? 'bg-primary/5' : ''} ${disabled ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={disabled}
                            onChange={() => toggleSelect(it.filePath)}
                            className="w-4 h-4 accent-primary cursor-pointer disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-3 py-2 text-foreground truncate max-w-[200px]" title={it.fileName}>{it.fileName}</td>
                        <td className="px-3 py-2 text-foreground/70 truncate max-w-[200px]" title={it.title}>{it.title}</td>
                        <td className="px-3 py-2 text-primary">{it.grade || '-'}</td>
                        <td className="px-3 py-2 text-emerald-600 dark:text-emerald-400">{it.subject || '-'}</td>
                        <td className="px-3 py-2 text-foreground/70">{it.totalPages}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs ${it.searchable === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {SEARCHABLE_LABEL[it.searchable] || it.searchable}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {it.error ? (
                            <span className="text-destructive" title={it.error}>解析错误</span>
                          ) : it.alreadyImported ? (
                            <span className="text-muted-foreground">已入库 #{it.existingPdfBookId}</span>
                          ) : it.legacyBookId ? (
                            <span className="text-violet-600 dark:text-violet-400">匹配旧库 #{it.legacyBookId}</span>
                          ) : (
                            <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><Check size={12} /> 待入库</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 从旧库播种 */}
      <div className="bg-background rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
          <Database size={20} className="text-violet-600 dark:text-violet-400" /> 从旧库播种
          <span className="text-xs font-normal text-muted-foreground">只读旧 Book 表，不修改图片版数据</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-foreground">限制数量</label>
            <input
              type="number"
              value={seedLimit}
              onChange={(e) => setSeedLimit(Number(e.target.value) || 5000)}
              className="w-28 px-3 py-2 border border-input bg-background text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button onClick={handleSeedDryRun} className="inline-flex items-center gap-2 bg-muted hover:bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium">
            Dry-run 预览
          </button>
          <button
            onClick={handleSeedCommit}
            disabled={seeding}
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-600/90 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {seeding ? '播种中...' : '执行播种'}
          </button>
          <button onClick={handleRecheck} className="inline-flex items-center gap-2 border border-input hover:bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium">
            <RefreshCw size={14} /> 复查可搜索性
          </button>
        </div>

        {seedResult && (
          <div className="mt-4 p-3 rounded-lg bg-muted/50 border border-border text-sm text-foreground/80">
            {seedResult.dryRun ? (
              <>
                检查旧库 <strong>{seedResult.examinedLegacyBooks}</strong> 本，候选 <strong>{seedResult.candidates}</strong> 本，
                待创建 <strong className="text-green-600 dark:text-green-400">{seedResult.toCreate}</strong> 本，
                跳过 <strong>{seedResult.skipped}</strong> 本。
              </>
            ) : (
              <>
                检查旧库 <strong>{seedResult.examinedLegacyBooks}</strong> 本，候选 <strong>{seedResult.candidates}</strong> 本，
                创建 <strong className="text-green-600 dark:text-green-400">{seedResult.created}</strong> 本，
                跳过 <strong>{seedResult.skipped}</strong> 本。
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 dark:border dark:border-amber-800 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
        <span>所有操作只写入 pdf_* 表，不修改图片版 Book / Annotation / Mistake / Assignment 表。导入后可在「PDF 书籍」中查看。</span>
      </div>
    </div>
  );
}
