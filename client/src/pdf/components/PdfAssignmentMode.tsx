import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Send, Trash2, CheckCircle2, CornerUpLeft,
  Pen, Highlighter, Eraser, Undo2, Redo2, Save, Download, FileText,
  RotateCw, RotateCcw, Maximize2, Minimize2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import DrawingCanvas, { type Stroke, type DrawingCanvasHandle } from '../../components/DrawingCanvas';
import { useConfirm } from '../../components/ConfirmDialog';
import { renderPageOffscreen } from '../lib/pdfjs';
import {
  getAssignmentStrokes, saveAssignmentStrokes, updateAssignment, deleteAssignment,
  listAssignments, exportAssignmentPage, type PdfAssignment,
} from '../api/pdfClient';
import { formatAssignmentTitle } from '../../utils/assignment';
import { toast } from 'sonner';

const HIGHLIGHT_COLOR = 'rgba(255, 235, 59, 0.35)';
const PEN_COLORS = ['#000000', '#e11d48', '#2563eb'];
const AUTOSAVE_DEBOUNCE_MS = 1500;
const AUTOSAVE_MAX_INTERVAL_MS = 10000;
/** 导出底图的渲染宽度（PDF 是矢量，放大不失真，取大值保证清晰度） */
const EXPORT_RENDER_WIDTH = 1600;

interface Props {
  bookId: number;
  bookTitle: string;
  canGrade?: boolean;
  totalPages: number;
  /** pdf.js 文档对象（父层已缓存） */
  doc: any;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  assignment: PdfAssignment;
  onExit: () => void;
  onAssignmentUpdate: () => void;
  pageAssignments: PdfAssignment[];
  onSwitchAssignment: (a: PdfAssignment | null) => void;
}

/**
 * PDF 模式的做题 / 批改全屏层。
 *
 * 与图片版 AssignmentMode 交互一致：自动保存（debounce + 离场兜底）、翻页前强制保存、
 * 保存失败阻断翻页、提交/批改/退回/删除、撤销重做、导出。
 *
 * 三处与图片版的实质差异：
 *   1. 底图不再是 PNG，而是 pdf.js 渲染的矢量页面（缩放与导出都不失真）。
 *   2. 笔迹按 layer 严格分离：保存前过滤出当前 layer，避免图片版「教师保存会把
 *      学生笔迹复制成 teacher 层」的问题。
 *   3. 导出用离屏重渲染整页再叠笔迹，不再依赖页面图的自然尺寸。
 */
export default function PdfAssignmentMode({
  bookId, bookTitle, canGrade = false, totalPages, doc,
  currentPage, setCurrentPage, assignment,
  onExit, onAssignmentUpdate, pageAssignments, onSwitchAssignment,
}: Props) {
  const confirm = useConfirm();
  const canvasRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const strokesRef = useRef<Stroke[]>([]);
  const lastSaveAttemptRef = useRef(Date.now());
  const lastSavedPageRef = useRef(currentPage);

  const isGraded = assignment?.status === 'graded';
  const isSubmitted = assignment?.status === 'submitted';
  const isReturned = assignment?.status === 'returned';
  const canEdit = assignment?.status === 'draft' || isReturned;
  const readOnly = isGraded || (isSubmitted && !canGrade);
  const layer: 'student' | 'teacher' = canGrade ? 'teacher' : 'student';

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [savedStrokes, setSavedStrokes] = useState<Stroke[]>([]);
  const [strokesLoaded, setStrokesLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [tool, setTool] = useState<'pen' | 'highlighter' | 'eraser'>('pen');
  const [color, setColor] = useState('#000000');
  const [penWidth, setPenWidth] = useState(2);

  const [fitMode, setFitMode] = useState<'page' | 'width'>('page');
  const [rotation, setRotation] = useState(0);
  const [ratio, setRatio] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [exporting, setExporting] = useState(false);

  lastSavedPageRef.current = currentPage;
  strokesRef.current = strokes;

  // ── 页面宽高比 ────────────────────────────────────────────
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(currentPage);
        const v = page.getViewport({ scale: 1 });
        if (!cancelled) setRatio(v.height / v.width);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [doc, currentPage]);

  // ── 画布尺寸（适页 / 适宽） ──────────────────────────────
  const calcSize = useCallback(() => {
    const el = containerRef.current;
    if (!el || !ratio) return;
    const cw = el.clientWidth - 32;
    const ch = el.clientHeight - 32;
    const isRotated = ((rotation % 360) + 360) % 360 === 90 || ((rotation % 360) + 360) % 360 === 270;
    const rw = isRotated ? ratio : 1;
    const rh = isRotated ? 1 : ratio;
    const widthZoom = cw / rw;
    const heightZoom = ch / rh;
    const zoom = fitMode === 'width' ? widthZoom : Math.min(widthZoom, heightZoom);
    setCanvasSize({ w: Math.max(1, Math.round(rw * zoom)), h: Math.max(1, Math.round(rh * zoom)) });
  }, [ratio, rotation, fitMode]);

  useEffect(() => { calcSize(); }, [calcSize]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => calcSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [calcSize]);

  // ── 笔迹加载 ──────────────────────────────────────────────
  useEffect(() => {
    if (!assignment) return;
    setStrokesLoaded(false);
    let cancelled = false;
    getAssignmentStrokes(assignment.id, currentPage)
      .then((dbStrokes) => {
        if (cancelled) return;
        const mapped: Stroke[] = dbStrokes.map((s) => ({
          id: s.id,
          tool: s.tool as 'pen' | 'highlighter',
          color: s.color,
          width: s.width,
          points: s.points,
        }));
        setStrokes(mapped);
        setSavedStrokes(mapped);
        setDirty(false);
        setCanUndo(false);
        setCanRedo(false);
        setStrokesLoaded(true);
      })
      .catch(() => { if (!cancelled) setStrokesLoaded(true); });
    return () => { cancelled = true; };
  }, [assignment?.id, currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  function strokesEqual(a: Stroke[], b: Stroke[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  const handleStrokesChange = useCallback((next: Stroke[]) => {
    setStrokes(next);
    setDirty(!strokesEqual(next, savedStrokes));
    setCanUndo(canvasRef.current?.canUndo() ?? false);
    setCanRedo(canvasRef.current?.canRedo() ?? false);
  }, [savedStrokes]);

  /** 唯一的写入通道，串行化避免并发覆盖 */
  const persist = useCallback((page: number, data: Stroke[], silent = true): Promise<boolean> => {
    if (!assignment || isGraded) return Promise.resolve(true);
    lastSaveAttemptRef.current = Date.now();
    const run = saveChainRef.current.then(async () => {
      try {
        await saveAssignmentStrokes(assignment.id, page, layer, data);
        setSavedStrokes(data);
        // 保存期间又有新笔迹时不清除 dirty，否则这些笔画永远不会落库
        if (strokesRef.current === data) setDirty(false);
        return true;
      } catch (err: any) {
        console.error('[pdf] save strokes failed:', err);
        if (!silent) toast.error('保存失败: ' + (err?.message || '网络错误'));
        return false;
      }
    });
    saveChainRef.current = run.catch(() => undefined);
    return run;
  }, [assignment, isGraded, layer]);

  // 自动保存
  useEffect(() => {
    if (!assignment || isGraded || !dirty || !strokesLoaded) return;
    const sinceLast = Date.now() - lastSaveAttemptRef.current;
    const delay = sinceLast >= AUTOSAVE_MAX_INTERVAL_MS ? 0 : AUTOSAVE_DEBOUNCE_MS;
    const timer = window.setTimeout(() => {
      void persist(lastSavedPageRef.current, strokesRef.current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [assignment, isGraded, dirty, strokesLoaded, strokes, persist]);

  // 离场兜底：切后台 / 关闭页面
  useEffect(() => {
    const flush = () => {
      if (dirty && !isGraded && assignment) {
        void persist(lastSavedPageRef.current, strokesRef.current);
      }
    };
    const onVisibility = () => { if (document.hidden) flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [dirty, isGraded, assignment, persist]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty || isGraded) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, isGraded]);

  const saveCurrentPage = useCallback(async (showToast = false): Promise<boolean> => {
    if (!assignment || isGraded || !dirty) return true;
    setSaving(true);
    const ok = await persist(lastSavedPageRef.current, strokes, !showToast);
    setSaving(false);
    if (ok && showToast) toast.success('保存成功');
    return ok;
  }, [assignment, isGraded, dirty, strokes, persist]);

  const handlePageChange = useCallback(async (newPage: number) => {
    if (assignment && dirty && !isGraded) {
      setSaving(true);
      const ok = await persist(currentPage, strokes, false);
      setSaving(false);
      if (!ok) {
        toast.error('保存失败，无法翻页');
        return;
      }
    }
    setCurrentPage(newPage);
    onAssignmentUpdate();
  }, [assignment, dirty, isGraded, currentPage, strokes, persist, setCurrentPage, onAssignmentUpdate]);

  // 与图片版一致：翻到某页后若已有作业，自动切到该页作业（手动切换时由 guard 跳过）
  const switchGuardRef = useRef(false);
  useEffect(() => {
    if (switchGuardRef.current) { switchGuardRef.current = false; return; }
    const others = pageAssignments.filter((a) => a.id !== assignment?.id);
    if (others.length > 0) onSwitchAssignment(others[0]);
  }, [currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 状态流转 ──────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!assignment) return;
    const ok = await confirm({
      title: '提交作业',
      message: '提交后将不能再修改，确定提交吗？',
      confirmText: '提交',
      confirmClass: 'bg-blue-600 text-white hover:bg-blue-700',
    });
    if (!ok) return;
    if (!(await saveCurrentPage())) return;
    try {
      await updateAssignment(assignment.id, { status: 'submitted' });
      toast.success('作业已提交');
      onAssignmentUpdate();
    } catch (e: any) {
      toast.error('提交失败: ' + (e?.message || ''));
    }
  };

  const handleDeleteAssignment = async () => {
    if (!assignment) return;
    const ok = await confirm({
      title: '删除作业',
      message: `确定删除「${formatAssignmentTitle(assignment.title) || `作业 #${assignment.id}`}」吗？`,
      confirmText: '删除',
      confirmClass: 'bg-red-600 text-white hover:bg-red-700',
    });
    if (!ok) return;
    try {
      await deleteAssignment(assignment.id);
      toast.success('作业已删除');
      onAssignmentUpdate();
      onExit();
    } catch (e: any) {
      toast.error('删除失败: ' + (e?.message || ''));
    }
  };

  const handleMarkGraded = async () => {
    if (!assignment) return;
    const ok = await confirm({
      title: '确认批改',
      message: '确认将此作业标记为已批改吗？标记后将不能继续编辑笔迹。',
      confirmText: '确认批改',
      confirmClass: 'bg-green-600 text-white hover:bg-green-700',
    });
    if (!ok) return;
    if (!(await saveCurrentPage())) return;
    try {
      await updateAssignment(assignment.id, { status: 'graded' });
      toast.success('作业已批改');
      onAssignmentUpdate();
    } catch (e: any) {
      toast.error('批改失败: ' + (e?.message || ''));
    }
  };

  const handleReturn = async () => {
    if (!assignment || !isSubmitted) return;
    const ok = await confirm({
      title: '打回作业',
      message: '打回后学生可以修改。本次批改笔迹不会保存。',
      confirmText: '打回',
      confirmClass: 'bg-amber-600 text-white hover:bg-amber-700',
    });
    if (!ok) return;
    try {
      await updateAssignment(assignment.id, { status: 'returned' });
      toast.success('作业已打回');
      onAssignmentUpdate();
    } catch (e: any) {
      toast.error('打回失败: ' + (e?.message || ''));
    }
  };

  const handleExit = useCallback(async () => {
    // 与图片版一致：退出前保存失败要阻断退出，否则笔迹会丢失
    if (assignment && dirty && !isGraded) {
      const ok = await saveCurrentPage();
      if (!ok) {
        toast.error('保存失败，无法退出');
        return;
      }
    }
    onExit();
    // 退出后清理全书空作业（draft 且无任何笔迹），避免垃圾数据累积（与图片版一致）
    cleanupEmptyAssignments();
  }, [assignment, dirty, isGraded, saveCurrentPage, onExit]);

  // 退出时清理当前书下「无笔迹的草稿作业」，与原图版行为对齐
  const cleanupEmptyAssignments = useCallback(() => {
    (async () => {
      try {
        const { data } = await listAssignments(bookId, { pageSize: 200 });
        const drafts = data.filter((a) => a.status !== 'graded' && a.status !== 'submitted');
        for (const a of drafts) {
          const strokes = await getAssignmentStrokes(a.id);
          if (!strokes || strokes.length === 0) {
            await deleteAssignment(a.id).catch(() => {});
          }
        }
        onAssignmentUpdate();
      } catch { /* 清理失败不影响退出 */ }
    })();
  }, [bookId, onAssignmentUpdate]);

  // ── 导出 ──────────────────────────────────────────────────
  const handleExport = async () => {
    if (!doc) return;
    setExporting(true);
    try {
      const info = await exportAssignmentPage(assignment.id, currentPage);
      const pageCanvas = await renderPageOffscreen(doc, currentPage, EXPORT_RENDER_WIDTH);
      const out = document.createElement('canvas');
      out.width = pageCanvas.width;
      out.height = pageCanvas.height;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(pageCanvas, 0, 0);
      for (const s of info.strokes) {
        drawStrokeFull(ctx, {
          tool: s.tool,
          color: s.color,
          width: s.width,
          points: s.points,
        }, out.width, out.height);
      }
      const link = document.createElement('a');
      const titlePart = formatAssignmentTitle(assignment.title) || `assignment-${assignment.id}`;
      link.download = `${bookTitle} ${titlePart} page-${currentPage}.jpg`;
      link.href = out.toDataURL('image/jpeg', 0.9);
      link.click();
    } catch (e: any) {
      toast.error('导出失败: ' + (e?.message || ''));
    } finally {
      setExporting(false);
    }
  };

  const statusLabel = isGraded
    ? <span className="text-green-400">（已批改）</span>
    : isSubmitted
      ? <span className="text-blue-400">（已提交）</span>
      : isReturned
        ? <span className="text-amber-400">（已打回）</span>
        : null;

  const saveState = saving
    ? <span className="text-yellow-400">保存中...</span>
    : dirty
      ? <span className="text-orange-400">未保存</span>
      : <span className="text-green-400">已保存</span>;

  const layoutClass = rotation === 90 ? 'flex-row-reverse' : rotation === 270 ? 'flex-row' : 'flex-col';

  const pageNumbers = useMemo(() => pageAssignments.map((_, i) => pageAssignments.length - i), [pageAssignments]);

  return (
    <div
      className="absolute inset-0 z-40 flex select-none bg-[#525659]"
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <div className={`flex ${layoutClass}`} style={{ width: '100%', height: '100%' }}>
        {/* 顶栏 */}
        <div className={`flex items-center gap-2 bg-[#323639] px-2 py-1.5 ${rotation === 90 || rotation === 270 ? 'h-full w-12 flex-col' : 'w-full'}`}>
          <button onClick={() => void handleExit()} title="退出做题" className="rounded p-1 text-white/80 hover:bg-white/10">
            <X size={16} />
          </button>

          <div className={`min-w-0 flex-1 ${rotation === 90 || rotation === 270 ? 'hidden' : ''}`}>
            <div className="flex items-center gap-1.5 truncate text-xs text-white">
              <span className="truncate">{bookTitle}</span>
              <span className="text-white/40">/</span>
              <span className="truncate">{formatAssignmentTitle(assignment.title) || `作业 #${assignment.id}`}</span>
              {statusLabel}
            </div>
          </div>

          {/* 本页作业切换器 */}
          {pageAssignments.length > 1 && !(rotation === 90 || rotation === 270) && (
            <div className="flex items-center gap-1">
              {pageAssignments.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => onSwitchAssignment(a)}
                  className={`h-6 w-6 rounded text-[10px] transition ${
                    a.id === assignment.id
                      ? 'bg-blue-600 text-white'
                      : a.status === 'graded'
                        ? 'border border-green-500 text-green-400'
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                  }`}
                >
                  {pageNumbers[i]}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-0.5">
            <button onClick={() => setRotation((r) => r + 90)} title="顺时针旋转" className="rounded p-1 text-white/80 hover:bg-white/10">
              <RotateCw size={14} />
            </button>
            <button onClick={() => setRotation((r) => r - 90)} title="逆时针旋转" className="rounded p-1 text-white/80 hover:bg-white/10">
              <RotateCcw size={14} />
            </button>
            <button onClick={() => setFitMode('page')} title="适应页面" className={`rounded p-1 hover:bg-white/10 ${fitMode === 'page' ? 'text-blue-400' : 'text-white/80'}`}>
              <Minimize2 size={14} />
            </button>
            <button onClick={() => setFitMode('width')} title="适应宽度" className={`rounded p-1 hover:bg-white/10 ${fitMode === 'width' ? 'text-blue-400' : 'text-white/80'}`}>
              <Maximize2 size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => void handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded p-1 text-white/80 hover:bg-white/10 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-white/90 tabular-nums">{currentPage} / {totalPages}</span>
            <button
              onClick={() => void handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="rounded p-1 text-white/80 hover:bg-white/10 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {!(rotation === 90 || rotation === 270) && <div className="text-[10px]">{saveState}</div>}

          <div className="flex items-center gap-0.5">
            {canEdit && (
              <>
                <button onClick={() => void handleSubmit()} title="提交作业" className="rounded p-1 text-blue-400 hover:bg-white/10">
                  <Send size={14} />
                </button>
                <button onClick={() => void handleDeleteAssignment()} title="删除作业" className="rounded p-1 text-red-400 hover:bg-white/10">
                  <Trash2 size={14} />
                </button>
              </>
            )}
            {canGrade && isSubmitted && (
              <>
                <button onClick={() => void handleMarkGraded()} title="标记已批改" className="rounded p-1 text-green-400 hover:bg-white/10">
                  <CheckCircle2 size={14} />
                </button>
                <button onClick={() => void handleReturn()} title="打回" className="rounded p-1 text-amber-400 hover:bg-white/10">
                  <CornerUpLeft size={14} />
                </button>
              </>
            )}
            <button onClick={() => void handleExport()} disabled={exporting} title="导出当前页" className="rounded p-1 text-white/80 hover:bg-white/10 disabled:opacity-40">
              <Download size={14} />
            </button>
          </div>
        </div>

        {/* 画布区 */}
        <div ref={containerRef} className="flex flex-1 items-center justify-center overflow-auto p-4">
          {canvasSize.w > 0 && canvasSize.h > 0 && (
            <div
              className="relative"
              style={{
                width: canvasSize.w,
                height: canvasSize.h,
                transform: `rotate(${rotation}deg)`,
                transformOrigin: 'center center',
              }}
            >
              <PageLayerUnderlay doc={doc} pageNumber={currentPage} width={canvasSize.w} height={canvasSize.h} />
              <DrawingCanvas
                ref={canvasRef}
                width={canvasSize.w}
                height={canvasSize.h}
                rotation={rotation}
                strokes={strokes}
                layer={layer}
                readOnly={readOnly}
                tool={tool}
                color={color}
                penWidth={penWidth}
                onStrokesChange={handleStrokesChange}
              />
            </div>
          )}
        </div>

        {/* 工具栏 / 只读条 */}
        {!readOnly ? (
          <div className="flex h-12 items-center gap-2 bg-[#323639] px-3">
            <button
              onClick={() => setTool('pen')}
              className={`rounded p-1.5 ${tool === 'pen' ? 'bg-blue-600 text-white' : 'text-white/80 hover:bg-white/10'}`}
              title="钢笔"
            >
              <Pen size={16} />
            </button>
            <button
              onClick={() => { setTool('highlighter'); setColor(HIGHLIGHT_COLOR); setPenWidth(12); }}
              className={`rounded p-1.5 ${tool === 'highlighter' ? 'bg-blue-600 text-white' : 'text-white/80 hover:bg-white/10'}`}
              title="荧光笔"
            >
              <Highlighter size={16} />
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`rounded p-1.5 ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'text-white/80 hover:bg-white/10'}`}
              title="橡皮擦"
            >
              <Eraser size={16} />
            </button>

            {tool === 'pen' && (
              <div className="flex items-center gap-1">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setColor(c); setPenWidth(2); }}
                    className={`h-4 w-4 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}

            <div className="mx-1 h-5 w-px bg-white/20" />

            <button
              onClick={() => { canvasRef.current?.undo(); setDirty(!strokesEqual(strokesRef.current, savedStrokes)); }}
              disabled={!canUndo}
              className="rounded p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
              title="撤销"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={() => { canvasRef.current?.redo(); setDirty(!strokesEqual(strokesRef.current, savedStrokes)); }}
              disabled={!canRedo}
              className="rounded p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
              title="重做"
            >
              <Redo2 size={16} />
            </button>
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: '清空笔迹',
                  message: '确定清空本页全部笔迹吗？',
                  confirmText: '清空',
                  confirmClass: 'bg-red-600 text-white hover:bg-red-700',
                });
                if (!ok) return;
                canvasRef.current?.clear();
              }}
              className="rounded p-1.5 text-white/80 hover:bg-white/10"
              title="清空本页"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={() => void saveCurrentPage(true)}
              disabled={!dirty || saving}
              className="rounded p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-30"
              title="保存"
            >
              <Save size={16} />
            </button>
          </div>
        ) : (
          <div className="flex h-12 items-center gap-2 bg-[#323639] px-3 text-xs text-white/70">
            <FileText size={14} />
            此作业{isGraded ? '已批改' : '已提交'}，笔迹只读
          </div>
        )}
      </div>
    </div>
  );
}

/** 页面底图（pdf.js 渲染），尺寸与上层 DrawingCanvas 严格一致 */
function PageLayerUnderlay({ doc, pageNumber, width, height }: { doc: any; pageNumber: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!doc || !canvas || width <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (width / base.width) * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const task = page.render({ canvasContext: ctx, viewport });
        await task.promise;
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') console.error('[pdf] underlay render failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [doc, pageNumber, width, height]);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 h-full w-full"
      style={{ width, height }}
    />
  );
}

/** 导出时按目标像素宽度重画笔迹（与图片版 drawStrokeFull 同逻辑） */
function drawStrokeFull(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number) {
  if (stroke.points.length === 0) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width * (w / 800);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1;

  if (stroke.points.length === 1) {
    const p = stroke.points[0];
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x * w, stroke.points[0].y * h);
  for (let i = 1; i < stroke.points.length; i++) {
    const prev = stroke.points[i - 1];
    const p = stroke.points[i];
    const midX = ((prev.x + p.x) / 2) * w;
    const midY = ((prev.y + p.y) / 2) * h;
    ctx.quadraticCurveTo(prev.x * w, prev.y * h, midX, midY);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
