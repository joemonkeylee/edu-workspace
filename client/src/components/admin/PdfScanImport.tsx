import { useState, useRef, useEffect, useCallback } from 'react';
import {
  getScanCapacity, scanPdfUrl, updateScanConcurrency, previewScanPdf, getScanPdfTicket,
  submitVideoPlan, getVideoRoots, repointVideoRoot, recheckVideos,
} from '../../api/client';
import type { PreviewFile, VideoPlanItemPayload, VideoRootInfo } from '../../api/client';
import { useStore } from '../../store/useStore';
import { Scan, StopCircle, FolderOpen, Clock, Layers, Eye, Database, AlertTriangle, Copy, Check, ChevronDown, X, Video, HardDrive, RefreshCw, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import VideoMatchReview from './VideoMatchReview';

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

const PATH_HISTORY_KEY = 'edu-scan-path-history';
const MAX_HISTORY = 10;

function loadPathHistory(): string[] {
  try {
    const raw = localStorage.getItem(PATH_HISTORY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((s) => typeof s === 'string');
    }
  } catch { /* ignore */ }
  return [];
}

function savePathHistory(paths: string[]) {
  try {
    localStorage.setItem(PATH_HISTORY_KEY, JSON.stringify(paths.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

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
  const [copied, setCopied] = useState(false);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // 视频关联
  const [withVideo, setWithVideo] = useState(false);
  /** 导入时剥掉文件名里的广告水印（【爱豆爱做题】、【一手资源…】等） */
  const [cleanNames, setCleanNames] = useState(true);
  const [showReview, setShowReview] = useState(false);
  const [videoPlanId, setVideoPlanId] = useState('');
  const [videoRoot, setVideoRoot] = useState('');
  const [videoPlanLinks, setVideoPlanLinks] = useState(0);
  const [videoRoots, setVideoRoots] = useState<VideoRootInfo[]>([]);
  const [showRootPanel, setShowRootPanel] = useState(false);
  const [repointTarget, setRepointTarget] = useState('');
  const [newRootInput, setNewRootInput] = useState('');
  const [repointing, setRepointing] = useState(false);

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

  const loadVideoRoots = useCallback(async () => {
    try {
      setVideoRoots(await getVideoRoots());
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => {
    getScanCapacity().then(({ maxConcurrency: max }) => {
      setMaxConcurrency(max);
      setConcurrency((current) => Math.min(current, max));
    }).catch(() => setMaxConcurrency(1));
    setPathHistory(loadPathHistory());
    loadVideoRoots();
  }, [loadVideoRoots]);

  const pushPathToHistory = useCallback((p: string) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    setPathHistory((prev) => {
      const filtered = prev.filter((s) => s !== trimmed);
      const updated = [trimmed, ...filtered].slice(0, MAX_HISTORY);
      savePathHistory(updated);
      return updated;
    });
  }, []);

  const removeFromHistory = useCallback((p: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPathHistory((prev) => {
      const updated = prev.filter((s) => s !== p);
      savePathHistory(updated);
      return updated;
    });
  }, []);

  const handlePreview = async () => {
    if (!targetPath.trim()) return;
    pushPathToHistory(targetPath);
    setPreviewing(true);
    setPreviewFiles([]);
    setVideoPlanId('');
    setVideoPlanLinks(0);
    try {
      const result = await previewScanPdf(targetPath.trim(), grade || undefined, subject || undefined, category || undefined, withVideo, cleanNames);
      setPreviewFiles(result.files);
      setVideoRoot(result.videoRoot || targetPath.trim());
      if (withVideo && result.files.length > 0) {
        setShowReview(true);
      }
    } catch {
      setPreviewFiles([]);
    } finally {
      setPreviewing(false);
    }
  };

  const handleReviewConfirm = async (items: VideoPlanItemPayload[]) => {
    try {
      const res = await submitVideoPlan(videoRoot || targetPath.trim(), items);
      setVideoPlanId(res.planId);
      setVideoPlanLinks(res.links);
      setShowReview(false);
      toast.success(`视频关联方案已就绪：${res.pdfs} 个 PDF / ${res.links} 条关联`);
      startScan();
    } catch (e: any) {
      toast.error('保存视频关联方案失败: ' + (e?.message || ''));
    }
  };

  const renamedCount = previewFiles.filter((f) => f.renamed && f.rawFileName && f.rawFileName !== f.fileName).length;

  const handleCopyPreview = () => {
    if (previewFiles.length === 0) return;
    const lines = previewFiles.map(f =>
      `${f.fileName}\t${f.fullPath}\t${f.grade || '-'}\t${f.subject || '-'}\t${f.category}`
    );
    const text = ['文件名\t完整路径\t学期\t科目\t分类', ...lines].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const startScan = () => {
    // 开了视频关联但还没确认过对应关系的，先走预解析
    if (withVideo && !videoPlanId) {
      toast('开启视频关联后，需要先「预解析」并确认 PDF 与 MP4 的对应关系');
      handlePreview();
      return;
    }
    setShowConfirm(true);
  };

  const confirmScan = async () => {
    setShowConfirm(false);
    if (!targetPath.trim()) return;
    pushPathToHistory(targetPath);
    doneRef.current = false;
    setScanning(true);
    setLogs([]);
    setProgress(null);
    logBufferRef.current = [];

    const taskId = createTaskId();
    setScanTaskId(taskId);

    // Get a one-time SSE ticket first (avoids putting auth token in URL)
    let ticket: string | undefined;
    try {
      ticket = await getScanPdfTicket();
    } catch (e: any) {
      toast.error('获取扫描凭证失败: ' + (e?.message || ''));
      setScanning(false);
      return;
    }

    const url = scanPdfUrl(
      targetPath.trim(),
      category.trim(),
      dpi,
      concurrency,
      taskId,
      grade.trim() || undefined,
      subject.trim() || undefined,
      !importToDb,
      ticket,
      videoPlanId || undefined,
      cleanNames,
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
      setVideoPlanId('');
      fetchBooks();
      loadVideoRoots();
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
            className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            disabled={scanning}
            onKeyDown={(e) => { if (e.key === 'Escape') setShowHistory(false); }}
          />
          {pathHistory.length > 0 && (
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title="历史路径"
            >
              <ChevronDown size={16} className={`transition-transform ${showHistory ? 'rotate-180' : ''}`} />
            </button>
          )}
          {showHistory && pathHistory.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
              {pathHistory.map((p) => (
                <div
                  key={p}
                  onClick={() => { setTargetPath(p); setShowHistory(false); }}
                  className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 cursor-pointer group"
                >
                  <span className="text-sm text-gray-700 truncate flex-1">{p}</span>
                  <button
                    onClick={(e) => removeFromHistory(p, e)}
                    className="ml-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="删除"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {showHistory && (
          <div className="fixed inset-0 z-0" onClick={() => setShowHistory(false)} />
        )}
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

        {/* 文件名清洗 */}
        <div className="mt-4 border border-gray-200 rounded-lg p-3 bg-gray-50/60">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cleanNames}
              onChange={(e) => setCleanNames(e.target.checked)}
              className="w-4 h-4 accent-teal-600 cursor-pointer"
              disabled={scanning}
            />
            <Eraser size={15} className="text-primary" />
            <span className="text-sm font-semibold text-gray-700">清理文件名中的广告水印</span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            导入时剥掉 <code className="bg-gray-200 px-1 rounded">【爱豆爱做题】</code>、
            <code className="bg-gray-200 px-1 rounded">【一手资源更新有保障联系sanniaowl】</code>、
            加微信/QQ群、8 位以上数字串等噪声，书名和归档的 PDF 文件名都会用清理后的版本。
            讲次、课型、学期等真实信息保留。
          </p>
          {renamedCount > 0 && (
            <p className="text-xs text-teal-600 mt-1.5 ml-6 flex items-center gap-1">
              <Check size={12} /> 本次预解析有 {renamedCount} 个文件名含噪声，将被清理
            </p>
          )}
        </div>

        {/* 视频关联 */}
        <div className="mt-4 border border-gray-200 rounded-lg p-3 bg-gray-50/60">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={withVideo}
              onChange={(e) => setWithVideo(e.target.checked)}
              className="w-4 h-4 accent-teal-600 cursor-pointer"
              disabled={scanning}
            />
            <Video size={15} className="text-primary" />
            <span className="text-sm font-semibold text-gray-700">解析并关联 MP4 讲解视频</span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            按「讲次序号 + 标题相似度」把目录里的 MP4 匹配到 PDF。视频文件不会被复制，只记录原始路径。
            预解析后会先弹出对照表供你逐条确认，确认后才写入数据库。
          </p>
          {videoPlanId && (
            <p className="text-xs text-teal-600 mt-1.5 ml-6 flex items-center gap-1">
              <Check size={12} /> 已确认 {videoPlanLinks} 条视频关联，开始扫描后将一并写入
            </p>
          )}

          <div className="ml-6 mt-2">
            <button
              onClick={() => setShowRootPanel((v) => !v)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-primary transition"
            >
              <HardDrive size={12} />
              视频根目录管理（换盘后批量重定向）
              <ChevronDown size={12} className={`transition-transform ${showRootPanel ? 'rotate-180' : ''}`} />
            </button>
            {showRootPanel && (
              <div className="mt-2 bg-white border border-gray-200 rounded-lg p-3">
                {videoRoots.length === 0 ? (
                  <p className="text-xs text-gray-400">还没有已关联的视频</p>
                ) : (
                  <div className="space-y-1.5">
                    {videoRoots.map((r) => (
                      <div key={r.rootPath} className="flex items-start gap-2 text-xs">
                        <input
                          type="radio"
                          name="video-root"
                          checked={repointTarget === r.rootPath}
                          onChange={() => { setRepointTarget(r.rootPath); setNewRootInput(''); }}
                          className="mt-0.5 accent-primary cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-gray-700 break-all">{r.rootPath}</div>
                          <div className="text-gray-400">
                            {r.total} 个视频
                            {r.missing > 0 && <span className="text-red-500"> · {r.missing} 个文件缺失</span>}
                            {r.batches.length > 0 && ` · 批次 ${r.batches.join('、')}`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <input
                    value={newRootInput}
                    onChange={(e) => setNewRootInput(e.target.value)}
                    placeholder="新的根目录绝对路径（子目录结构需保持不变）"
                    className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    disabled={!repointTarget || !newRootInput.trim() || repointing}
                    onClick={async () => {
                      setRepointing(true);
                      try {
                        const res = await repointVideoRoot({ rootPath: repointTarget, newRoot: newRootInput.trim() });
                        toast.success(`已重定向 ${res.updated} 个视频${res.stillMissing > 0 ? `，${res.stillMissing} 个仍然缺失` : ''}`);
                        setNewRootInput('');
                        loadVideoRoots();
                      } catch (e: any) {
                        toast.error('重定向失败: ' + (e?.response?.data?.error || e?.message || ''));
                      } finally {
                        setRepointing(false);
                      }
                    }}
                    className="px-3 py-1 text-xs rounded bg-primary text-white hover:bg-primaryDark disabled:bg-gray-300 transition whitespace-nowrap"
                  >
                    {repointing ? '处理中...' : '重定向'}
                  </button>
                  <button
                    onClick={async () => {
                      const res = await recheckVideos();
                      toast.success(`复查完成：${res.total} 个视频，${res.missing} 个缺失，${res.recovered} 个恢复`);
                      loadVideoRoots();
                    }}
                    className="px-3 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition flex items-center gap-1 whitespace-nowrap"
                  >
                    <RefreshCw size={12} /> 复查
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

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
          <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              预解析结果（{previewFiles.length} 个文件）
            </span>
            <button
              onClick={handleCopyPreview}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-teal-600 transition px-2 py-1 rounded hover:bg-gray-100"
              title="复制结果"
            >
              {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              {copied ? '已复制' : '复制结果'}
            </button>
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
                    <td className="px-4 py-1.5 text-gray-800 truncate max-w-[200px]" title={f.rawFileName ? `${f.rawFileName} → ${f.fileName}` : f.fileName}>
                      {f.renamed && f.rawFileName ? (
                        <span className="flex items-center gap-1 min-w-0">
                          <span className="truncate text-gray-400 line-through">{f.rawFileName.replace(/\.pdf$/i, '')}</span>
                          <span className="text-teal-600 flex-shrink-0">→</span>
                          <span className="truncate">{f.fileName.replace(/\.pdf$/i, '')}</span>
                        </span>
                      ) : (
                        f.fileName
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-gray-500 truncate max-w-[300px]" title={f.fullPath}>{f.fullPath}</td>
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

      {/* 视频关联预处理 */}
      {showReview && previewFiles.length > 0 && (
        <VideoMatchReview
          files={previewFiles}
          videoRoot={videoRoot}
          onCancel={() => setShowReview(false)}
          onConfirm={handleReviewConfirm}
        />
      )}

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
                  {videoPlanId && (
                    <p>视频关联: <span className="text-teal-600">{videoPlanLinks} 条（仅记录路径，不复制文件）</span></p>
                  )}
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
