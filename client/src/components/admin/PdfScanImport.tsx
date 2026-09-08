import { useState, useRef, useEffect, useCallback } from 'react';
import { getScanCapacity, scanPdfUrl, updateScanConcurrency, previewScanPdf } from '../../api/client';
import type { PreviewFile } from '../../api/client';
import { useStore } from '../../store/useStore';
import { Scan, StopCircle, FolderOpen, Clock, Layers, Eye, Database, AlertTriangle } from 'lucide-react';

interface ProgressData {
  phase?: number;
  current: number;
  total: number;
  overallCurrent?: number;
  overallTotal?: number;
  overallPct?: number;
  elapsed?: number;
  remaining?: number;
  message?: string;
}

const DPI_OPTIONS = [
  { value: 150, label: '150 (快速预览)' },
  { value: 200, label: '200 (推荐)' },
  { value: 300, label: '300 (高清)' },
  { value: 600, label: '600 (打印级)' },
];

const fmtTime = (s: number) => {
  if (s < 60) return `${Math.round(s)}秒`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}分${r}秒`;
};

function createTaskId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const GRADE_PRESETS = ['七上', '七下', '八上', '八下', '九上', '九下', '高一', '高二', '高三'];
const SUBJECT_PRESETS = ['语文', '数学', '英语', '物理', '化学', '生物', '道法', '历史', '地理', '科学', '政治', '美术', '音乐', '体育', '信息技术'];

export default function PdfScanImport() {
  const [targetPath, setTargetPath] = useState('');
  const [grade, setGrade] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('');
  const [dpi, setDpi] = useState(300);
  const [concurrency, setConcurrency] = useState(4);
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [scanTaskId, setScanTaskId] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [importToDb, setImportToDb] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const { fetchBooks, subjectOptions, gradeOptions, categoryOptions } = useStore();

  const logBufferRef = useRef<string[]>([]);
  const logRafRef = useRef<number | null>(null);
  const MAX_LOGS = 200;
  const flushLogs = useCallback(() => {
    logRafRef.current = null;
    if (logBufferRef.current.length === 0) return;
    const batch = logBufferRef.current;
    logBufferRef.current = [];
    setLogs((prev) => {
      const combined = [...prev, ...batch];
      return combined.length > MAX_LOGS ? combined.slice(-MAX_LOGS) : combined;
    });
  }, []);
  const appendLog = useCallback((messages: string[]) => {
    logBufferRef.current.push(...messages);
    if (logRafRef.current === null) {
      logRafRef.current = requestAnimationFrame(flushLogs);
    }
  }, [flushLogs]);

  const scrollRafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!autoScroll) return;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      logEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
  }, [logs, autoScroll]);

  useEffect(() => {
    getScanCapacity().then(({ maxConcurrency: max }) => {
      setMaxConcurrency(max);
      setConcurrency((current) => Math.min(current, max));
    }).catch(() => setMaxConcurrency(1));
  }, []);

  const handlePreview = async () => {
    if (!targetPath.trim()) return;
    setPreviewing(true);
    setPreviewFiles([]);
    try {
      const result = await previewScanPdf(targetPath.trim(), grade || undefined, subject || undefined, category || undefined);
      setPreviewFiles(result.files);
    } catch {
      setPreviewFiles([]);
    } finally {
      setPreviewing(false);
    }
  };

  const startScan = () => {
    setShowConfirm(true);
  };

  const confirmScan = () => {
    setShowConfirm(false);
    if (!targetPath.trim()) return;
    doneRef.current = false;
    setScanning(true);
    setLogs([]);
    setProgress(null);
    logBufferRef.current = [];

    const taskId = createTaskId();
    setScanTaskId(taskId);
    const url = scanPdfUrl(
      targetPath.trim(),
      category.trim(),
      dpi,
      concurrency,
      taskId,
      grade.trim() || undefined,
      subject.trim() || undefined,
      !importToDb,
    );
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('logBatch', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.messages)) {
        appendLog(data.messages);
      }
    });
    es.addEventListener('log', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      appendLog([data.message]);
    });
    es.addEventListener('progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setProgress(data);
    });
    es.addEventListener('done', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      appendLog([`✓ ${data.message}`]);
      if (logRafRef.current !== null) {
        cancelAnimationFrame(logRafRef.current);
        flushLogs();
      }
      doneRef.current = true;
      setScanning(false);
      setProgress(null);
      es.close();
      setScanTaskId('');
      fetchBooks();
    });
    es.addEventListener('error', (e: Event) => {
      if (doneRef.current) return;
      const me = e as MessageEvent;
      if (me.data) {
        try {
          const data = JSON.parse(me.data);
          appendLog([`✗ ${data.message}`]);
        } catch { /* ignore */ }
      }
      if (logRafRef.current !== null) {
        cancelAnimationFrame(logRafRef.current);
        flushLogs();
      }
      setScanning(false);
      setProgress(null);
      es.close();
      setScanTaskId('');
    });
  };

  const stopScan = () => {
    esRef.current?.close();
    setScanning(false);
    setProgress(null);
    setScanTaskId('');
    appendLog(['⏹ 已手动停止']);
  };

  useEffect(() => () => {
    esRef.current?.close();
    if (logRafRef.current !== null) cancelAnimationFrame(logRafRef.current);
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  useEffect(() => {
    if (!scanning || !scanTaskId) return;
    updateScanConcurrency(scanTaskId, concurrency).catch(() => {});
    const interval = window.setInterval(() => {
      updateScanConcurrency(scanTaskId, concurrency).catch(() => {});
    }, 500);
    return () => window.clearInterval(interval);
  }, [scanning, scanTaskId, concurrency]);

  useEffect(() => {
    if (!scanning) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '扫描正在进行中，离开页面会中断当前导入任务。';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [scanning]);

  const pagePct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const overallPct = progress?.overallPct ?? 0;
  const phase1 = progress?.phase === 1;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Input form */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">本地目录绝对路径</label>
        <div className="relative">
          <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            placeholder="/Users/username/Documents/textbooks 或 C:\Users\..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            disabled={scanning}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1.5">支持递归扫描子目录，自动以一级子目录名作为分类</p>

        {/* Override selectors */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">学期（可选）</label>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
              disabled={scanning}
            >
              <option value="">自动解析</option>
              {GRADE_PRESETS.map(g => <option key={g} value={g}>{g}</option>)}
              {gradeOptions.filter(g => !GRADE_PRESETS.includes(g)).map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">科目（可选）</label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
              disabled={scanning}
            >
              <option value="">自动解析</option>
              {SUBJECT_PRESETS.map(s => <option key={s} value={s}>{s}</option>)}
              {subjectOptions.filter(s => !SUBJECT_PRESETS.includes(s)).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">分类（可选）</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
              disabled={scanning}
            >
              <option value="">自动取目录名</option>
              {categoryOptions.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
            </select>
          </div>
        </div>

        {/* DPI + concurrency */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div>
            <label className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-2">
              <Layers size={14} /> 渲染 DPI
            </label>
            <select
              value={dpi}
              onChange={(e) => setDpi(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
              disabled={scanning}
            >
              {DPI_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-2">
              <Layers size={14} /> 并发数
            </label>
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
            >
              {Array.from({ length: maxConcurrency }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>{value} 并发</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-2">
              <Database size={14} /> 数据入库
            </label>
            <label className="flex items-center gap-2 h-[38px] cursor-pointer">
              <input
                type="checkbox"
                checked={importToDb}
                onChange={(e) => setImportToDb(e.target.checked)}
                className="w-4 h-4 accent-teal-600 cursor-pointer"
              />
              <span className="text-sm text-gray-600">{importToDb ? '写入数据库' : '仅渲染图片'}</span>
            </label>
          </div>
        </div>

        {!importToDb && (
          <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
            <AlertTriangle size={12} /> 不入库模式：仅按文件哈希匹配已有书籍，渲染图片到对应目录，不创建新书记录
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mt-4">
          <button
            onClick={handlePreview}
            disabled={previewing || scanning || !targetPath.trim()}
            className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-300 text-gray-700 px-4 py-2.5 rounded-lg transition text-sm font-medium"
          >
            <Eye size={18} /> {previewing ? '解析中...' : '预解析'}
          </button>
          <button
            onClick={startScan}
            disabled={scanning || !targetPath.trim()}
            className="flex items-center gap-2 bg-primary hover:bg-primaryDark disabled:bg-gray-300 text-white px-6 py-2.5 rounded-lg transition text-sm font-medium"
          >
            <Scan size={18} /> 开始扫描
          </button>
          {scanning && (
            <button
              onClick={stopScan}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2.5 rounded-lg transition text-sm font-medium"
            >
              <StopCircle size={18} /> 停止
            </button>
          )}
        </div>
      </div>

      {/* Preview table */}
      {previewFiles.length > 0 && (
        <div className="bg-white rounded-lg shadow mb-4 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-200 text-sm font-semibold text-gray-700">
            预解析结果（{previewFiles.length} 个文件）
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">文件名</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">完整路径</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">学期</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">科目</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">分类</th>
                </tr>
              </thead>
              <tbody>
                {previewFiles.map((f, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-1.5 text-gray-800 truncate max-w-[200px]">{f.fileName}</td>
                    <td className="px-4 py-1.5 text-gray-500 truncate max-w-[300px]">{f.fullPath}</td>
                    <td className="px-4 py-1.5">
                      {f.grade ? <span className="text-blue-600">{f.grade}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-1.5">
                      {f.subject ? <span className="text-green-600">{f.subject}</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-1.5 text-gray-700">{f.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Overall progress with time estimate */}
      {progress && (
        <div className="bg-white rounded-lg shadow p-4 mb-4 space-y-3">
          <div>
            <div className="flex justify-between text-sm text-gray-600 mb-1.5">
              <span className="font-medium">{phase1 ? '文件分析' : '总进度'}</span>
              <span>
                {phase1
                  ? `${progress.current} / ${progress.total} 个文件`
                  : `${progress.overallCurrent ?? 0} / ${progress.overallTotal ?? 0} 页 (${overallPct}%)`}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-primary h-3 rounded-full transition-all duration-150"
                style={{
                  width: phase1
                    ? `${(progress.current / progress.total) * 100}%`
                    : `${overallPct}%`,
                }}
              />
            </div>
          </div>

          {!phase1 && progress.total > 0 && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>当前书籍</span>
                <span>{progress.current}/{progress.total} ({pagePct}%)</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-400 h-2 rounded-full transition-all duration-150" style={{ width: `${pagePct}%` }} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Clock size={12} /> 已用 {fmtTime(progress.elapsed ?? 0)}
            </span>
            {(progress.remaining ?? 0) > 0 && (
              <span className="flex items-center gap-1">
                <Clock size={12} /> 剩余 {fmtTime(progress.remaining ?? 0)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Log console */}
      <div className="bg-gray-900 rounded-lg shadow overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
          <span className="text-gray-400 text-xs font-mono">实时日志控制台</span>
          <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="w-3.5 h-3.5 accent-teal-500 cursor-pointer"
            />
            自动滚动
          </label>
        </div>
        <div className="font-mono text-sm p-4 h-80 overflow-auto scrollbar-thin">
          {logs.length === 0 && !scanning && <div className="text-gray-500">等待开始扫描...</div>}
          {logs.map((log, i) => (
            <div
              key={i}
              className={
                log.startsWith('✓') ? 'text-green-400'
                  : log.startsWith('✗') ? 'text-red-400'
                    : log.includes('总进度') ? 'text-blue-400'
                      : log.includes('预计') || log.includes('耗时') ? 'text-yellow-400'
                        : 'text-gray-300'
              }
            >
              {log}
            </div>
          ))}
          {scanning && <div className="text-yellow-400 animate-pulse">▌</div>}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">确认开始扫描</h3>
                <p className="text-sm text-gray-600">
                  即将扫描 <span className="font-semibold text-gray-900">{targetPath}</span>
                </p>
                <div className="mt-2 space-y-0.5 text-xs text-gray-500">
                  <p>DPI: <span className="text-gray-700">{dpi}</span> | 并发: <span className="text-gray-700">{concurrency}</span></p>
                  <p>入库模式: <span className={importToDb ? 'text-green-600' : 'text-amber-600'}>{importToDb ? '写入数据库' : '仅渲染图片（不入库）'}</span></p>
                  {grade && <p>学期: <span className="text-gray-700">{grade}</span></p>}
                  {subject && <p>科目: <span className="text-gray-700">{subject}</span></p>}
                  {category && <p>分类: <span className="text-gray-700">{category}</span></p>}
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition"
              >
                取消
              </button>
              <button
                onClick={confirmScan}
                className="px-6 py-2 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primaryDark transition"
              >
                确认扫描
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
