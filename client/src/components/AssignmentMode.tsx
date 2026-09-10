import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Pen, Highlighter, Eraser, Undo2, Redo2,
  ChevronLeft, ChevronRight, X, Save, CheckCircle2,
  Download, FileText, RotateCw, RotateCcw, Minimize2, Maximize2, Trash2, Send, CornerUpLeft,
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
  pageAssignments: Assignment[];
  onSwitchAssignment: (a: Assignment | null) => void;
}

type DrawTool = 'pen' | 'highlighter' | 'eraser';

const COLORS = [
  { name: 'black', value: '#1a1a1a' },
  { name: 'blue', value: '#2563eb' },
  { name: 'red', value: '#dc2626' },
];

const HIGHLIGHT_COLOR = 'rgba(250, 204, 21, 0.5)';

export default function AssignmentMode({
  bookId, bookTitle, canGrade = false, totalPages, storagePath, currentPage, setCurrentPage,
  assignment, onExit, onAssignmentUpdate, pageAssignments, onSwitchAssignment,
}: AssignmentModeProps) {
  const [tool, setTool] = useState<DrawTool>('pen');
  const [color, setColor] = useState(COLORS[0].value);
  const [penWidth, setPenWidth] = useState(2);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [savedStrokes, setSavedStrokes] = useState<Stroke[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [strokesLoaded, setStrokesLoaded] = useState(false);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const [localRotation, setLocalRotation] = useState(0);
  const [localZoom, setLocalZoom] = useState(0);
  const [fitMode, setFitMode] = useState<'page' | 'width'>('page');
  const [gestureScale, setGestureScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);
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
  const isSubmitted = assignment?.status === 'submitted';
  const isReturned = assignment?.status === 'returned';
  const canEdit = assignment?.status === 'draft' || isReturned;
  const readOnly = isGraded || (isSubmitted && !canGrade);
  const layer = 'student';

  const effectiveRotation = ((localRotation % 360) + 360) % 360;
  const isRotated = effectiveRotation === 90 || effectiveRotation === 270;
  const chineseRotation = effectiveRotation === 90
    ? 90
    : effectiveRotation === 180
      ? 0
      : effectiveRotation === 270
        ? 90
        : 0;
  const toolbarRotationClass = effectiveRotation === 180 ? 'rotate-180' : '';
  const rotatedDir = effectiveRotation === 90 ? 'flex-col' : 'flex-col-reverse';
  const textFlipClass = effectiveRotation === 270 ? 'rotate-180' : '';
  const iconRotationAll = isRotated
    ? effectiveRotation === 90 ? '[&_button]:rotate-90' : '[&_button]:-rotate-90'
    : '';
  const layoutDirectionClass = effectiveRotation === 90
    ? 'flex-row-reverse'
    : effectiveRotation === 180
      ? 'flex-col-reverse'
      : effectiveRotation === 270
        ? 'flex-row'
        : 'flex-col';

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

  useEffect(() => {
    const isInsideAssignmentMode = (target: EventTarget | null) => {
      return target instanceof Node && modeRef.current?.contains(target);
    };
    const blockSelectionEvent = (event: Event) => {
      if (!isInsideAssignmentMode(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const clearAssignmentSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const anchorInside = isInsideAssignmentMode(selection.anchorNode);
      const focusInside = isInsideAssignmentMode(selection.focusNode);
      if (anchorInside || focusInside) selection.removeAllRanges();
    };
    const blockPencilDefaults = (event: PointerEvent) => {
      if (event.pointerType !== 'pen' || !isInsideAssignmentMode(event.target)) return;
      event.preventDefault();
      clearAssignmentSelection();
    };
    const blockPencilTouchDefaults = (event: TouchEvent) => {
      const touches = [...event.changedTouches];
      const hasPencilTouch = touches.some((touch) => {
        const touchType = (touch as Touch & { touchType?: string }).touchType;
        return touchType === 'stylus' || touchType === 'pen';
      });
      if (!hasPencilTouch || !isInsideAssignmentMode(event.target)) return;
      event.preventDefault();
      clearAssignmentSelection();
    };
    const blockedEvents = ['selectstart', 'contextmenu', 'dragstart', 'copy', 'cut'];
    blockedEvents.forEach((name) => document.addEventListener(name, blockSelectionEvent, true));
    document.addEventListener('pointerdown', blockPencilDefaults, true);
    document.addEventListener('pointerup', blockPencilDefaults, true);
    document.addEventListener('pointercancel', blockPencilDefaults, true);
    document.addEventListener('touchstart', blockPencilTouchDefaults, true);
    document.addEventListener('touchmove', blockPencilTouchDefaults, true);
    document.addEventListener('touchend', blockPencilTouchDefaults, true);
    document.addEventListener('touchcancel', blockPencilTouchDefaults, true);
    document.addEventListener('selectionchange', clearAssignmentSelection, true);
    return () => {
      blockedEvents.forEach((name) => document.removeEventListener(name, blockSelectionEvent, true));
      document.removeEventListener('pointerdown', blockPencilDefaults, true);
      document.removeEventListener('pointerup', blockPencilDefaults, true);
      document.removeEventListener('pointercancel', blockPencilDefaults, true);
      document.removeEventListener('touchstart', blockPencilTouchDefaults, true);
      document.removeEventListener('touchmove', blockPencilTouchDefaults, true);
      document.removeEventListener('touchend', blockPencilTouchDefaults, true);
      document.removeEventListener('touchcancel', blockPencilTouchDefaults, true);
      document.removeEventListener('selectionchange', clearAssignmentSelection, true);
    };
  }, []);

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

  // Auto-switch assignment when page changes: find assignment on the new page
  useEffect(() => {
    if (pageAssignments.length === 0) return;
    const onThisPage = pageAssignments.find(a => a.id === assignment?.id);
    if (!onThisPage) {
      onSwitchAssignment(pageAssignments[0]);
    }
  }, [pageAssignments]);

  // Load strokes when page or assignment changes
  useEffect(() => {
    if (!assignment) return;
    setStrokesLoaded(false);
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
      setStrokesLoaded(true);
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
        if (strokes.length === 0 && strokesLoaded) {
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
    onAssignmentUpdate();
  }, [assignment, dirty, isGraded, strokes, strokesLoaded, currentPage, layer, setCurrentPage, onExit, onAssignmentUpdate]);

  // On exit: save current page, then exit immediately, then clean up empty assignments async
  const handleExit = useCallback(async () => {
    if (assignment && dirty && !isGraded) {
      setSaving(true);
      try {
        await saveStrokes(assignment.id, lastSavedPageRef.current, layer, strokes);
        setSavedStrokes(strokes);
        setDirty(false);
      } catch (err) {
        console.error('Save on exit failed:', err);
      } finally {
        setSaving(false);
      }
    }
    // Exit immediately so UI is responsive
    onExit();
    // Clean up empty assignments asynchronously after exit
    try {
      const { assignments } = await getAssignments(bookId);
      for (const a of assignments) {
        if (a.status === 'graded') continue;
        const { strokes: allStrokes } = await getStrokes(a.id);
        if (allStrokes.length === 0) {
          await deleteAssignment(a.id);
        }
      }
      onAssignmentUpdate();
    } catch (err) {
      console.error('Cleanup empty assignments failed:', err);
    }
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

  const handleReturn = async () => {
    if (!assignment || !isSubmitted) return;
    const title = formatAssignmentTitle(assignment.title) || `作业 #${assignment.id}`;
    if (!window.confirm(`确认打回作业「${title}」吗？\n打回后学生可继续修改，不会保存任何批改笔迹。`)) return;
    await updateAssignment(assignment.id, { status: 'returned' });
    onAssignmentUpdate();
  };

  const handleSubmit = async () => {
    if (!assignment || !canEdit) return;
    const title = formatAssignmentTitle(assignment.title) || `作业 #${assignment.id}`;
    if (!window.confirm(`确认提交作业「${title}」吗？\n提交后作业将变为只读，无法再修改或删除。`)) return;
    const ok = await saveCurrentPage();
    if (!ok) return;
    await updateAssignment(assignment.id, { status: 'submitted' });
    onAssignmentUpdate();
  };

  const handleDeleteAssignment = async () => {
    if (!assignment || !canEdit) return;
    const title = formatAssignmentTitle(assignment.title) || `作业 #${assignment.id}`;
    if (!window.confirm(`确认删除作业「${title}」吗？\n此操作不可撤销，所有页面的笔迹都将被删除。`)) return;
    await deleteAssignment(assignment.id);
    onAssignmentUpdate();
    onExit();
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
      const titlePart = formatAssignmentTitle(assignment?.title) || `assignment-${assignment?.id}`;
      link.download = `${bookTitle} ${titlePart} page-${currentPage}.jpg`;
      link.href = exportCanvas.toDataURL('image/jpeg', 0.9);
      link.click();
    };
    img.src = pageImageUrl(storagePath, currentPage);
  };

  const canvasWidth = imgNatural.w * localZoom;
  const canvasHeight = imgNatural.h * localZoom;

  return (
    <div
      ref={modeRef}
      className={`assignment-mode absolute inset-0 z-40 bg-[#525659] flex select-none ${layoutDirectionClass}`}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'pen') e.preventDefault();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* Minimal top bar */}
      <div className={`bg-[#323639] text-white flex items-center flex-shrink-0 ${toolbarRotationClass} ${iconRotationAll} ${isRotated ? `h-full w-12 ${rotatedDir} gap-2 px-1 py-3` : 'gap-2 px-3 py-1.5'}`}>
        <button
          onClick={handleExit}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
          title="退出做题模式"
        >
          <X size={18} />
        </button>
        <span className={`flex-1 overflow-hidden flex flex-col justify-center leading-tight ${isRotated ? `[writing-mode:vertical-rl] ${textFlipClass}` : ''}`}>
          <span className="text-xs text-gray-400 truncate">{renderTextByCharacter(bookTitle, chineseRotation)}</span>
          <span className="text-xs text-gray-400 truncate">
            {renderTextByCharacter(formatAssignmentTitle(assignment?.title) || '作业', chineseRotation)}
            {isGraded && <> {renderTextByCharacter('(已批改)', chineseRotation, 'text-green-400 ml-1')}</>}
            {isSubmitted && !canGrade && <> {renderTextByCharacter('(已提交)', chineseRotation, 'text-blue-400 ml-1')}</>}
            {isReturned && <> {renderTextByCharacter('(已打回)', chineseRotation, 'text-amber-400 ml-1')}</>}
          </span>
        </span>
        {/* Page assignment switcher — show assignments on this page, newest first */}
        {pageAssignments.length > 0 && (
          <div className={`flex items-center gap-1 ${isRotated ? rotatedDir : ''}`}>
            {pageAssignments.map((a, i) => {
              const num = pageAssignments.length - i;
              const active = a.id === assignment?.id;
              const graded = a.status === 'graded';
              return (
                <button
                  key={a.id}
                  onClick={() => onSwitchAssignment(a)}
                  className={`flex items-center justify-center w-5 h-5 rounded-full border text-xs transition ${
                    active
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : graded
                        ? 'border-green-500 text-green-400 hover:bg-white/10'
                        : 'border-gray-500 text-gray-400 hover:text-white hover:border-white/50'
                  }`}
                  title={`作业${num} - ${formatAssignmentTitle(a.title) || `#${a.id}`}${graded ? ' (已批改)' : ''}`}
                >
                  {num}
                </button>
              );
            })}
          </div>
        )}
        <div className={isRotated ? 'flex-1' : 'flex-1'} />
        {/* Rotation */}
        <div className={isRotated ? `flex ${rotatedDir} items-center gap-1` : 'contents'}>
          <button
            onClick={() => setLocalRotation((r: number) => r + 90)}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
            title="顺时针旋转 90°"
          >
            <RotateCw size={16} />
          </button>
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
        </div>
        <div className={isRotated ? 'h-px w-5 bg-white/10 my-1' : 'w-px h-5 bg-white/10 mx-1'} />
        {/* Page navigation */}
        <div className={isRotated ? `flex ${rotatedDir} items-center gap-1` : 'contents'}>
          <button
            onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
          >
            <ChevronLeft size={18} />
          </button>
          <span className={`text-sm text-gray-300 text-center whitespace-nowrap ${isRotated ? `min-w-0 [writing-mode:vertical-rl] ${textFlipClass}` : 'min-w-[90px]'}`}>{currentPage} / {totalPages}</span>
          <button
            onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className={isRotated ? 'h-px w-5 bg-white/10 my-1' : 'w-px h-5 bg-white/10 mx-1'} />
        {saving && renderTextByCharacter('保存中...', chineseRotation, `text-xs text-yellow-400 ${isRotated ? `[writing-mode:vertical-rl] ${textFlipClass}` : ''}`)}
        {dirty && !saving && renderTextByCharacter('未保存', chineseRotation, `text-xs text-orange-400 ${isRotated ? `[writing-mode:vertical-rl] ${textFlipClass}` : ''}`)}
        {!dirty && !saving && renderTextByCharacter('已保存', chineseRotation, `text-xs text-green-400 ${isRotated ? `[writing-mode:vertical-rl] ${textFlipClass}` : ''}`)}
        <div className={isRotated ? 'h-px w-5 bg-white/10 my-1' : 'w-px h-5 bg-white/10 mx-1'} />
        {canEdit && assignment && (
          <>
            <button
              onClick={handleSubmit}
              className="p-1.5 rounded text-gray-400 hover:text-[#5eead4] hover:bg-white/10 transition"
              title="提交作业"
            >
              <Send size={16} />
            </button>
            <button
              onClick={handleDeleteAssignment}
              className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-white/10 transition"
              title="删除作业"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
        {canGrade && isSubmitted && assignment && (
          <>
            <button
              onClick={handleMarkGraded}
              className="p-1.5 rounded text-gray-400 hover:text-green-400 hover:bg-white/10 transition"
              title="标记为已批改"
            >
              <CheckCircle2 size={16} />
            </button>
            <button
              onClick={handleReturn}
              className="p-1.5 rounded text-gray-400 hover:text-amber-400 hover:bg-white/10 transition"
              title="打回作业"
            >
              <CornerUpLeft size={16} />
            </button>
          </>
        )}
      </div>

      {/* Drawing area — same pattern as BookViewer: single overflow-auto container + min-h-full wrapper */}
      <div
        ref={containerRef}
        className="min-h-0 min-w-0 flex-1 overflow-auto touch-none select-none"
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
        onPointerDown={handleTouchStart}
        onPointerMove={handleTouchMove}
        onPointerUp={handleTouchEnd}
        onPointerCancel={handleTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
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
        <div className={`relative z-50 flex flex-shrink-0 items-center justify-center gap-1 bg-[#323639] ${toolbarRotationClass} ${iconRotationAll} ${isRotated ? `h-full w-12 ${rotatedDir} px-2 py-3` : 'h-12 px-3 py-2'}`}>
          {/* Tool buttons */}
          <div className={`flex items-center gap-0.5 ${isRotated ? rotatedDir : ''}`}>
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

          <div className={isRotated ? 'h-px w-6 bg-white/10 my-1' : 'w-px h-6 bg-white/10 mx-1'} />

          {/* Color picker (pen mode only) */}
          {tool === 'pen' && (
            <div className={`flex items-center gap-1 ${isRotated ? rotatedDir : ''}`}>
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

          <div className={isRotated ? 'h-px w-6 bg-white/10 my-1' : 'w-px h-6 bg-white/10 mx-1'} />

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

          <div className={isRotated ? 'h-px w-6 bg-white/10 my-1' : 'w-px h-6 bg-white/10 mx-1'} />

          {/* Clear all */}
          <button
            onClick={() => {
              if (strokes.length === 0) return;
              if (window.confirm('确认清除当前页所有笔迹？')) {
                canvasRef.current?.clear();
              }
            }}
            disabled={strokes.length === 0}
            className="p-2 rounded text-gray-400 hover:text-red-400 hover:bg-white/10 disabled:opacity-30 transition"
            title="清除所有笔迹"
          >
            <Trash2 size={18} />
          </button>

          <div className={isRotated ? 'h-px w-6 bg-white/10 my-1' : 'w-px h-6 bg-white/10 mx-1'} />

          {/* Manual save */}
          <button
            onClick={saveCurrentPage}
            disabled={!dirty || saving}
            className="p-2 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
            title="保存"
          >
            <Save size={18} />
          </button>

          <div className={isRotated ? 'h-px w-6 bg-white/10 my-1' : 'w-px h-6 bg-white/10 mx-1'} />

          {/* Export current page */}
          <button
            onClick={handleExport}
            className="p-2 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
            title="导出当前页"
          >
            <Download size={18} />
          </button>
        </div>
      )}

      {/* Read-only banner with export */}
      {readOnly && (
        <div className={`flex-shrink-0 bg-[#323639] flex items-center justify-center gap-2 text-gray-400 text-sm ${toolbarRotationClass} ${iconRotationAll} ${isRotated ? `h-full w-12 ${rotatedDir} px-2 py-3 [writing-mode:vertical-rl] ${textFlipClass}` : 'h-12 px-3 py-2'}`}>
          <FileText size={16} />
          {isGraded
            ? renderTextByCharacter('此作业已批改，笔迹只读', chineseRotation)
            : renderTextByCharacter('此作业已提交，笔迹只读', chineseRotation)}
          <div className={isRotated ? 'h-px w-6 bg-white/10 my-1' : 'w-px h-6 bg-white/10 mx-2'} />
          <button
            onClick={handleExport}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
            title="导出当前页"
          >
            <Download size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function renderTextByCharacter(text: string, rotation: number, className = '') {
  return (
    <span className={className}>
      {[...text].map((character, index) => {
        const isChineseCharacter = /[\u3400-\u9fff]/.test(character);
        if (!isChineseCharacter) {
          return (
            <span key={`${character}-${index}`}>
              {character}
            </span>
          );
        }
        return (
          <span
            key={`${character}-${index}`}
            className="inline-block"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            {character}
          </span>
        );
      })}
    </span>
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
