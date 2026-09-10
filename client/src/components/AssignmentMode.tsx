import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Pen, Highlighter, Eraser, Undo2, Redo2,
  ChevronLeft, ChevronRight, X, Save, CheckCircle2,
  Download, FileText, RotateCcw, Minimize2, Maximize2,
} from 'lucide-react';
import DrawingCanvas, { DrawingCanvasHandle, Stroke } from './DrawingCanvas';
import { pageImageUrl, getStrokes, saveStrokes, deleteAssignment, getAssignments, updateAssignment, type Assignment, type AssignmentStroke } from '../api/client';
import { formatAssignmentTitle } from '../utils/assignment';

export interface AssignmentModeProps {
  bookId: number;
  bookTitle: string;
  canGrade?: boolean;
  totalPages: number;
  storagePath: string;
  currentPage: number;
  setCurrentPage: (p: number) => void;
  assignment: Assignment | null;
  onExit: () => void;
  onAssignmentUpdate: () => void;
}

type DrawTool = 'pen' | 'highlighter' | 'eraser';

const COLORS = [
  { name: 'black', value: '#1a1a1a' },
  { name: 'red', value: '#dc2626' },
  { name: 'blue', value: '#2563eb' },
];

const HIGHLIGHT_COLOR = 'rgba(250, 204, 21, 0.5)';

export default function AssignmentMode({
  bookId, bookTitle, canGrade = false, totalPages, storagePath, currentPage, setCurrentPage,
  assignment, onExit, onAssignmentUpdate,
}: AssignmentModeProps) {
  const [tool, setTool] = useState<DrawTool>('pen');
  const [color, setColor] = useState(COLORS[0].value);
  const [penWidth, setPenWidth] = useState(2);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [savedStrokes, setSavedStrokes] = useState<Stroke[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const [localRotation, setLocalRotation] = useState(0);
  const [localZoom, setLocalZoom] = useState(0);
  const [fitMode, setFitMode] = useState<'page' | 'width'>('page');
  const [gestureScale, setGestureScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSavedPageRef = useRef(currentPage);
  const autoRotatedRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{
    startScale: number;
    startPan: { x: number; y: number };
    startDistance: number;
    startMidpoint: { x: number; y: number };
  } | null>(null);

  const isGraded = assignment?.status === 'graded';
  const readOnly = isGraded;
  const layer = 'student';

  const effectiveRotation = ((localRotation % 360) + 360) % 360;
  const isRotated = effectiveRotation === 90 || effectiveRotation === 270;

  const updateViewport = useCallback((scale: number, pan: { x: number; y: number }) => {
    const nextScale = Math.max(0.5, Math.min(4, scale));
    gestureScaleRef.current = nextScale;
    panOffsetRef.current = pan;
    setGestureScale(nextScale);
    setPanOffset(pan);
  }, []);

  const resetViewport = useCallback(() => {
    touchPointsRef.current.clear();
    gestureRef.current = null;
    updateViewport(1, { x: 0, y: 0 });
  }, [updateViewport]);

  useEffect(() => {
    resetViewport();
  }, [currentPage, effectiveRotation, fitMode, resetViewport]);

  const handleTouchStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = [...touchPointsRef.current.values()];
    if (points.length === 1) {
      gestureRef.current = {
        startScale: gestureScaleRef.current,
        startPan: panOffsetRef.current,
        startDistance: 0,
        startMidpoint: points[0],
      };
    } else if (points.length === 2) {
      const [first, second] = points;
      gestureRef.current = {
        startScale: gestureScaleRef.current,
        startPan: panOffsetRef.current,
        startDistance: Math.hypot(second.x - first.x, second.y - first.y),
        startMidpoint: {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        },
      };
    }
  };

  const handleTouchMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch' || !gestureRef.current) return;
    e.preventDefault();
    touchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = [...touchPointsRef.current.values()];
    const gesture = gestureRef.current;
    if (points.length === 1) {
      updateViewport(gesture.startScale, {
        x: gesture.startPan.x + points[0].x - gesture.startMidpoint.x,
        y: gesture.startPan.y + points[0].y - gesture.startMidpoint.y,
      });
    } else if (points.length >= 2 && gesture.startDistance > 0) {
      const [first, second] = points;
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      updateViewport(gesture.startScale * distance / gesture.startDistance, {
        x: gesture.startPan.x + midpoint.x - gesture.startMidpoint.x,
        y: gesture.startPan.y + midpoint.y - gesture.startMidpoint.y,
      });
    }
  };

  const handleTouchEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return;
    touchPointsRef.current.delete(e.pointerId);
    if (touchPointsRef.current.size === 0) {
      gestureRef.current = null;
      return;
    }
    const remaining = [...touchPointsRef.current.values()][0];
    gestureRef.current = {
      startScale: gestureScaleRef.current,
      startPan: panOffsetRef.current,
      startDistance: 0,
      startMidpoint: remaining,
    };
  };

  // Load strokes when page or assignment changes
  useEffect(() => {
    if (!assignment) return;
    let cancelled = false;
    getStrokes(assignment.id, currentPage).then(({ strokes: dbStrokes }) => {
      if (cancelled) return;
      const mapped: Stroke[] = dbStrokes.map((s: AssignmentStroke) => ({
        id: s.id,
        tool: s.tool as 'pen' | 'highlighter',
        color: s.color,
        width: s.width,
        points: s.points,
      }));
      setStrokes(mapped);
      setSavedStrokes(mapped);
      setDirty(false);
    });
    return () => { cancelled = true; };
  }, [assignment, currentPage]);

  // Load natural image dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = pageImageUrl(storagePath, currentPage);
  }, [storagePath, currentPage]);

  // Auto-rotate on first image load: align page long edge with screen long edge
  useEffect(() => {
    if (autoRotatedRef.current || imgNatural.w === 0) return;
    autoRotatedRef.current = true;
    const isScreenLandscape = window.innerWidth > window.innerHeight;
    const isPageLandscape = imgNatural.w > imgNatural.h;
    if (isScreenLandscape !== isPageLandscape) {
      setLocalRotation(-90);
    }
  }, [imgNatural]);

  // Calculate zoom to fit container — same pattern as BookViewer
  const calcLocalZoom = useCallback(() => {
    if (!containerRef.current || imgNatural.w === 0 || imgNatural.h === 0) return;
    const cw = containerRef.current.clientWidth - 32;
    const ch = containerRef.current.clientHeight - 32;
    if (cw <= 0 || ch <= 0) return;
    const isRot = effectiveRotation === 90 || effectiveRotation === 270;
    const natW = isRot ? imgNatural.h : imgNatural.w;
    const natH = isRot ? imgNatural.w : imgNatural.h;
    const widthZoom = cw / natW;
    const heightZoom = ch / natH;
    setLocalZoom(fitMode === 'width' ? widthZoom : Math.min(widthZoom, heightZoom));
  }, [imgNatural, effectiveRotation, fitMode]);

  useEffect(() => { calcLocalZoom(); }, [calcLocalZoom]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => calcLocalZoom());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [calcLocalZoom]);

  // Save current page, returns success
  const saveCurrentPage = useCallback(async (): Promise<boolean> => {
    if (!assignment || isGraded) return true;
    if (!dirty) return true;
    setSaving(true);
    try {
      await saveStrokes(assignment.id, lastSavedPageRef.current, layer, strokes);
      setSavedStrokes(strokes);
      setDirty(false);
      return true;
    } catch (err) {
      console.error('Auto-save failed:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [assignment, isGraded, dirty, strokes, layer]);

  // Save before page change; if saved strokes are empty, delete the assignment
  const handlePageChange = useCallback(async (newPage: number) => {
    if (assignment && dirty && !isGraded) {
      setSaving(true);
      try {
        await saveStrokes(assignment.id, currentPage, layer, strokes);
        setSavedStrokes(strokes);
        setDirty(false);
        if (strokes.length === 0) {
          const { strokes: allStrokes } = await getStrokes(assignment.id);
          if (allStrokes.length === 0) {
            await deleteAssignment(assignment.id);
            onExit();
            return;
          }
        }
      } catch (err) {
        console.error('Save before page change failed:', err);
      } finally {
        setSaving(false);
      }
    }
    lastSavedPageRef.current = newPage;
    setCurrentPage(newPage);
  }, [assignment, dirty, isGraded, strokes, currentPage, layer, setCurrentPage, onExit]);

  // On exit: save current page, then clean up empty assignments (only if save succeeded)
  const handleExit = useCallback(async () => {
    let saveOk = true;
    if (assignment && dirty && !isGraded) {
      setSaving(true);
      try {
        await saveStrokes(assignment.id, lastSavedPageRef.current, layer, strokes);
        setSavedStrokes(strokes);
        setDirty(false);
      } catch (err) {
        console.error('Save on exit failed:', err);
        saveOk = false;
      } finally {
        setSaving(false);
      }
    }
    // Only clean up empty assignments if save succeeded
    if (saveOk) {
      try {
        const { assignments } = await getAssignments(bookId);
        for (const a of assignments) {
          if (a.status === 'graded') continue;
          const { strokes: allStrokes } = await getStrokes(a.id);
          if (allStrokes.length === 0) {
            await deleteAssignment(a.id);
          }
        }
      } catch (err) {
        console.error('Cleanup empty assignments failed:', err);
      }
    }
    onAssignmentUpdate();
    onExit();
  }, [assignment, dirty, isGraded, strokes, layer, bookId, onExit, onAssignmentUpdate]);

  const handleStrokesChange = useCallback((newStrokes: Stroke[]) => {
    setStrokes(newStrokes);
    const changed = JSON.stringify(newStrokes) !== JSON.stringify(savedStrokes);
    setDirty(changed);
  }, [savedStrokes]);

  const handleMarkGraded = async () => {
    if (!assignment) return;
    const confirmed = window.confirm('确认将此作业标记为已批改吗？标记后将不能继续编辑笔迹。');
    if (!confirmed) return;
    const ok = await saveCurrentPage();
    if (!ok) return;
    await updateAssignment(assignment.id, { status: 'graded' });
    onAssignmentUpdate();
  };

  const handleExport = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current.exportCanvas();
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = img.naturalWidth;
      exportCanvas.height = img.naturalHeight;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      for (const stroke of strokes) {
        drawStrokeFull(ctx, stroke, img.naturalWidth, img.naturalHeight);
      }
      const link = document.createElement('a');
      link.download = `assignment-${assignment?.id}-page-${currentPage}.jpg`;
      link.href = exportCanvas.toDataURL('image/jpeg', 0.9);
      link.click();
    };
    img.src = pageImageUrl(storagePath, currentPage);
  };

  const canvasWidth = imgNatural.w * localZoom;
  const canvasHeight = imgNatural.h * localZoom;

  return (
    <div className="absolute inset-0 z-40 bg-[#525659] flex flex-col">
      {/* Minimal top bar */}
      <div className="bg-[#323639] text-white px-3 py-1.5 flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleExit}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
          title="退出做题模式"
        >
          <X size={18} />
        </button>
        <span className="text-sm text-gray-200">
          {bookTitle} · {formatAssignmentTitle(assignment?.title) || '作业'} {isGraded && <span className="text-green-400 ml-1">(已批改)</span>}
        </span>
        <div className="flex-1" />
        {/* Rotation */}
        <button
          onClick={() => setLocalRotation((r: number) => r - 90)}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
          title="逆时针旋转 90°"
        >
          <RotateCcw size={16} />
        </button>
        <button
          onClick={() => setFitMode('page')}
          className={`p-1.5 rounded transition ${fitMode === 'page' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          title="适应页面"
        >
          <Minimize2 size={16} />
        </button>
        <button
          onClick={() => setFitMode('width')}
          className={`p-1.5 rounded transition ${fitMode === 'width' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          title="适应宽度"
        >
          <Maximize2 size={16} />
        </button>
        <div className="w-px h-5 bg-white/10 mx-1" />
        {/* Page navigation */}
        <button
          onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm text-gray-300 min-w-[60px] text-center">{currentPage} / {totalPages}</span>
        <button
          onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
        >
          <ChevronRight size={18} />
        </button>
        <div className="w-px h-5 bg-white/10 mx-1" />
        {saving && <span className="text-xs text-yellow-400">保存中...</span>}
        {dirty && !saving && <span className="text-xs text-orange-400">未保存</span>}
        {!dirty && !saving && <span className="text-xs text-green-400">已保存</span>}
        <div className="w-px h-5 bg-white/10 mx-1" />
        <button
          onClick={handleExport}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
          title="导出当前页"
        >
          <Download size={16} />
        </button>
        {canGrade && !isGraded && assignment && (
          <button
            onClick={handleMarkGraded}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
            title="标记为已批改"
          >
            <CheckCircle2 size={16} />
          </button>
        )}
      </div>

      {/* Drawing area — same pattern as BookViewer: single overflow-auto container + min-h-full wrapper */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto touch-none"
        onPointerDown={handleTouchStart}
        onPointerMove={handleTouchMove}
        onPointerUp={handleTouchEnd}
        onPointerCancel={handleTouchEnd}
      >
        <div className="min-h-full flex items-center justify-center p-4">
          {imgNatural.w > 0 && (
            <div
              className="flex items-center justify-center"
              style={{
                width: isRotated ? `${canvasHeight}px` : `${canvasWidth}px`,
                height: isRotated ? `${canvasWidth}px` : `${canvasHeight}px`,
                minWidth: imgNatural.w > 0 ? undefined : '100%',
                minHeight: imgNatural.h > 0 ? undefined : '100%',
              }}
            >
              <div
                style={{
                  width: `${canvasWidth}px`,
                  height: `${canvasHeight}px`,
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) rotate(${localRotation}deg) scale(${gestureScale})`,
                  transformOrigin: 'center center',
                  position: 'relative',
                }}
              >
                <img
                  src={pageImageUrl(storagePath, currentPage)}
                  alt={`Page ${currentPage}`}
                  className="block"
                  style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
                  draggable={false}
                />
                <DrawingCanvas
                  ref={canvasRef}
                  width={canvasWidth}
                  height={canvasHeight}
                  rotation={localRotation}
                  strokes={strokes}
                  layer={layer}
                  readOnly={readOnly}
                  tool={tool}
                  color={color}
                  penWidth={penWidth}
                  onStrokesChange={handleStrokesChange}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating toolbar */}
      {!readOnly && (
        <div className="flex-shrink-0 bg-[#323639] px-3 py-2 flex items-center justify-center gap-1">
          {/* Tool buttons */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setTool('pen')}
              className={`p-2 rounded transition ${tool === 'pen' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
              title="钢笔"
            >
              <Pen size={18} />
            </button>
            <button
              onClick={() => { setTool('highlighter'); setColor(HIGHLIGHT_COLOR); setPenWidth(12); }}
              className={`p-2 rounded transition ${tool === 'highlighter' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
              title="高亮笔"
            >
              <Highlighter size={18} />
            </button>
            <button
              onClick={() => setTool('eraser')}
              className={`p-2 rounded transition ${tool === 'eraser' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
              title="橡皮擦 (点选删除)"
            >
              <Eraser size={18} />
            </button>
          </div>

          <div className="w-px h-6 bg-white/10 mx-1" />

          {/* Color picker (pen mode only) */}
          {tool === 'pen' && (
            <div className="flex items-center gap-1">
              {COLORS.map((c) => (
                <button
                  key={c.name}
                  onClick={() => { setColor(c.value); setPenWidth(2); }}
                  className={`w-6 h-6 rounded-full border-2 transition ${color === c.value ? 'border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          )}

          <div className="w-px h-6 bg-white/10 mx-1" />

          {/* Undo / Redo */}
          <button
            onClick={() => canvasRef.current?.undo()}
            className="p-2 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
            title="撤销"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={() => canvasRef.current?.redo()}
            className="p-2 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
            title="重做"
          >
            <Redo2 size={18} />
          </button>

          <div className="w-px h-6 bg-white/10 mx-1" />

          {/* Manual save */}
          <button
            onClick={saveCurrentPage}
            disabled={!dirty || saving}
            className="p-2 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
            title="保存"
          >
            <Save size={18} />
          </button>
        </div>
      )}

      {/* Read-only banner */}
      {readOnly && (
        <div className="flex-shrink-0 bg-[#323639] px-3 py-2 flex items-center justify-center gap-2 text-gray-400 text-sm">
          <FileText size={16} />
          此作业已批改，笔迹只读
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function drawStrokeFull(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number) {
  if (stroke.points.length === 0) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width * (w / 800); // scale relative to canvas
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
    const midX = (prev.x + p.x) / 2 * w;
    const midY = (prev.y + p.y) / 2 * h;
    ctx.quadraticCurveTo(prev.x * w, prev.y * h, midX, midY);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
