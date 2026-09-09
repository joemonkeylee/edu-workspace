import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import * as api from '../api/client';
import { pageImageUrl } from '../api/client';
import TocTree from '../components/TocTree';
import PageCanvas from '../components/PageCanvas';
import CropTool from '../components/CropTool';
import type { ToolMode } from '../types';
import {
  ArrowLeft,
  MousePointer2,
  StickyNote,
  Highlighter,
  Scissors,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Book,
  BookOpen,
  PanelLeft,
  PanelRight,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Trash2,
  CheckCircle2,
  Circle,
  RotateCcw,
  Layers,
  Download,
  PenLine,
  MoreVertical,
} from 'lucide-react';
import { buildAnnotationColorIndex, getAnnotationColor } from '../utils/annotationColors';
import AssignmentMode from '../components/AssignmentMode';
import AssignmentList from '../components/AssignmentList';
import type { Assignment } from '../api/client';

type FitMode = 'width' | 'page' | null;
type PageLayout = 'single' | 'double';

export default function BookViewer() {
  const { id } = useParams();
  const bookId = Number(id);
  const navigate = useNavigate();

  const {
    currentBook,
    currentPage,
    zoom,
    tool,
    annotations,
    mistakes,
    loading,
    fetchBook,
    fetchAnnotations,
    fetchMistakes,
    setCurrentPage,
    setZoom,
    setTool,
    removeAnnotation,
    clearCurrent,
  } = useStore();

  // Persisted reading config (per book)
  const STORAGE_KEY = 'edu-readConfig';

  function loadReadConfig(bookId: number) {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const cfg = all[String(bookId)] || {};
      return {
        page: cfg.page || 1,
        pageLayout: cfg.pageLayout || 'single',
        fitMode: cfg.fitMode || 'page',
        rotation: cfg.rotation || 0,
      };
    } catch {
      return { page: 1, pageLayout: 'single' as PageLayout, fitMode: 'page' as FitMode, rotation: 0 };
    }
  }

  function saveReadConfig(bookId: number, data: Record<string, any>) {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      all[String(bookId)] = { ...all[String(bookId)], ...data };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  }

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'annotations' | 'mistakes' | 'assignments'>('annotations');
  const [mistakeFilter, setMistakeFilter] = useState('');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [layers, setLayers] = useState({
    annotations: true,
    highlights: true,
    assignments: true,
    grading: true,
  });
  const [layerDropdownOpen, setLayerDropdownOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  const [deleteAnnId, setDeleteAnnId] = useState<number | null>(null);
  const skipClearRef = useRef(false); // skip clearing when navigating via annotation click
  const [assignmentMode, setAssignmentMode] = useState(false);
  const [currentAssignment, setCurrentAssignment] = useState<Assignment | null>(null);
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);

  // Clear annotation selection when page changes via toolbar/keyboard
  useEffect(() => {
    if (skipClearRef.current) {
      skipClearRef.current = false;
      return;
    }
    setSelectedAnnotationId(null);
  }, [currentPage]);

  // Clear annotation selection when annotations are hidden
  useEffect(() => {
    if (!showAnnotations || !layers.annotations) setSelectedAnnotationId(null);
  }, [showAnnotations, layers.annotations]);

  const [savedConfig, setSavedConfig] = useState(() => bookId ? loadReadConfig(bookId) : null);
  const [fitMode, setFitMode] = useState<FitMode>(savedConfig?.fitMode || 'page');
  const [pageLayout, setPageLayout] = useState<PageLayout>(savedConfig?.pageLayout || 'single');
  const [rotation, setRotation] = useState(savedConfig?.rotation || 0); // degrees, negative = CCW
  const effectiveRotation = ((rotation % 360) + 360) % 360; // normalize to 0-359
  const mainRef = useRef<HTMLDivElement>(null);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const [selectedDpi, setSelectedDpi] = useState<number>(0);

  useEffect(() => {
    if (bookId) {
      const cfg = loadReadConfig(bookId);
      setSavedConfig(cfg);
      setFitMode(cfg.fitMode);
      setPageLayout(cfg.pageLayout);
      setRotation(cfg.rotation);
      fetchBook(bookId).then(() => {
        if (cfg.page > 1) setCurrentPage(cfg.page);
      });
      fetchAnnotations(bookId);
    }
    return () => clearCurrent();
  }, [bookId]);

  // Persist config changes
  useEffect(() => {
    if (bookId) saveReadConfig(bookId, { pageLayout, fitMode, rotation });
  }, [bookId, pageLayout, fitMode, rotation]);

  // Persist last page (debounced via ref)
  const savePageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!bookId || !currentBook) return;
    if (savePageTimer.current) clearTimeout(savePageTimer.current);
    savePageTimer.current = setTimeout(() => {
      saveReadConfig(bookId, { page: currentPage });
    }, 500);
    return () => { if (savePageTimer.current) clearTimeout(savePageTimer.current); };
  }, [bookId, currentPage, currentBook]);

  const availableDpis: number[] = currentBook?.availableDpis || [];
  const activeDpi = selectedDpi || availableDpis[0] || 0;
  const effectiveStoragePath = activeDpi
    ? `/storage/books/${bookId}/${activeDpi}/`
    : currentBook?.storagePath || '';

  // Reset selectedDpi when book changes
  useEffect(() => {
    setSelectedDpi(0);
  }, [bookId]);

  // Load natural image dimensions for auto-fit calculation
  useEffect(() => {
    if (!currentBook) return;
    const img = new Image();
    img.onload = () => setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = pageImageUrl(effectiveStoragePath, currentPage);
  }, [currentBook, currentPage, effectiveStoragePath]);

  const effectiveLayout: PageLayout = tool !== 'view' ? 'single' : pageLayout;
  const isDouble = effectiveLayout === 'double' && currentPage < (currentBook?.totalPages ?? 0);

  const calcZoom = useCallback(() => {
    if (!fitMode || !mainRef.current) return;
    const container = mainRef.current;
    const cw = container.clientWidth - 32;
    const ch = container.clientHeight - 32;
    const pages = isDouble ? 2 : 1;
    if (imgNatural.w === 0 || imgNatural.h === 0) return;
    const pageGap = (pages - 1) * 4; // gap-1 = 4px

    // Swap dimensions when rotated 90 or 270 degrees
    const isRotated = effectiveRotation === 90 || effectiveRotation === 270;
    const natW = isRotated ? imgNatural.h : imgNatural.w;
    const natH = isRotated ? imgNatural.w : imgNatural.h;

    const availPerPage = (cw - pageGap) / pages;
    if (fitMode === 'width') {
      setZoom(availPerPage / natW);
    } else {
      const widthZoom = availPerPage / natW;
      const heightZoom = ch / natH;
      setZoom(Math.min(widthZoom, heightZoom));
    }
  }, [fitMode, imgNatural, isDouble, rotation, setZoom]);

  useEffect(() => { calcZoom(); }, [calcZoom]);

  useEffect(() => {
    if (!mainRef.current) return;
    const observer = new ResizeObserver(() => calcZoom());
    observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, [calcZoom]);

  useEffect(() => {
    if (!currentBook) return;
    const step = effectiveLayout === 'double' ? 2 : 1;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const el = mainRef.current;
      if (!el) return;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      if (e.deltaY < 0 && atTop && currentPage > 1) {
        e.preventDefault();
        setCurrentPage(Math.max(1, currentPage - step));
      } else if (e.deltaY > 0 && atBottom && currentPage < currentBook.totalPages) {
        e.preventDefault();
        setCurrentPage(Math.min(currentBook.totalPages, currentPage + step));
      }
    };
    const el = mainRef.current;
    el?.addEventListener('wheel', handler, { passive: false });
    return () => el?.removeEventListener('wheel', handler);
  }, [currentPage, currentBook, setCurrentPage, effectiveLayout]);

  const handleManualZoom = (delta: number) => {
    setFitMode(null);
    setZoom(zoom + delta);
  };

  // Chrome-style zoom levels
  const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

  const snapZoom = (value: number) => {
    const clamped = Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], value));
    let nearest = ZOOM_LEVELS[0];
    let minDiff = Math.abs(clamped - nearest);
    for (const lvl of ZOOM_LEVELS) {
      const diff = Math.abs(clamped - lvl);
      if (diff < minDiff) { minDiff = diff; nearest = lvl; }
    }
    return nearest;
  };

  const zoomIn = () => {
    setFitMode(null);
    const snapped = snapZoom(zoom);
    const next = ZOOM_LEVELS.find((lvl) => lvl > snapped + 0.001) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    setZoom(next);
  };

  const zoomOut = () => {
    setFitMode(null);
    const snapped = snapZoom(zoom);
    const prev = [...ZOOM_LEVELS].reverse().find((lvl) => lvl < snapped - 0.001) || ZOOM_LEVELS[0];
    setZoom(prev);
  };

  const [editingZoom, setEditingZoom] = useState(false);
  const [zoomInput, setZoomInput] = useState('');

  const startEditZoom = () => {
    setZoomInput(String(Math.round(zoom * 100)));
    setEditingZoom(true);
  };

  const commitZoom = () => {
    const val = parseFloat(zoomInput);
    if (!isNaN(val) && val > 0) {
      setFitMode(null);
      setZoom(snapZoom(val / 100));
    }
    setEditingZoom(false);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (!currentBook) return;
      const step = effectiveLayout === 'double' ? 2 : 1;
      if (e.key === 'ArrowLeft' && currentPage > 1) setCurrentPage(Math.max(1, currentPage - step));
      if (e.key === 'ArrowRight' && currentPage < currentBook.totalPages) setCurrentPage(Math.min(currentBook.totalPages, currentPage + step));
      if ((e.key === 'PageUp' || e.key === ' ') && currentPage > 1) { e.preventDefault(); setCurrentPage(Math.max(1, currentPage - step)); }
      if ((e.key === 'PageDown') && currentPage < currentBook.totalPages) { e.preventDefault(); setCurrentPage(Math.min(currentBook.totalPages, currentPage + step)); }
      if (e.key === 'Home') setCurrentPage(1);
      if (e.key === 'End') setCurrentPage(currentBook.totalPages);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPage, currentBook, setCurrentPage, effectiveLayout]);

  const handleSaveAnnotation = useCallback(
    async (data: { type: string; contentJson: any }) => {
      if (!currentBook) return;
      const formData = new FormData();
      formData.append('bookId', String(currentBook.id));
      formData.append('pageNumber', String(currentPage));
      formData.append('type', data.type);
      formData.append('contentJson', JSON.stringify(data.contentJson));
      await api.saveAnnotation(formData);
      await fetchAnnotations(currentBook.id);
    },
    [currentBook, currentPage, fetchAnnotations]
  );

  const handleCropSave = useCallback(
    async (blob: Blob, cropData: any, subject: string, tags: string) => {
      if (!currentBook) return;
      const formData = new FormData();
      formData.append('image', blob, 'crop.png');
      formData.append('bookId', String(currentBook.id));
      formData.append('pageNumber', String(currentPage));
      formData.append('type', 'crop');
      formData.append('contentJson', JSON.stringify(cropData));
      formData.append('subject', subject);
      formData.append('tags', tags);
      await api.saveAnnotation(formData);
      await fetchAnnotations(currentBook.id);
      setTool('view');
    },
    [currentBook, currentPage, fetchAnnotations, setTool]
  );

  const handleMistakeToggle = async (id: number, current: number) => {
    await api.updateMistake(id, { reviewStatus: current === 0 ? 1 : 0 });
    fetchMistakes(mistakeFilter ? { subject: mistakeFilter } : undefined);
  };

  const handleMistakeDelete = async (id: number) => {
    await api.deleteMistake(id);
    fetchMistakes(mistakeFilter ? { subject: mistakeFilter } : undefined);
  };

  const loadMistakes = () => {
    setRightTab('mistakes');
    fetchMistakes(mistakeFilter ? { subject: mistakeFilter } : undefined);
  };

  if (loading || !currentBook) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <div className="animate-pulse">加载中...</div>
      </div>
    );
  }

  const totalPages = currentBook.totalPages;
  const pageAnnotations = annotations.filter(
    (a) => a.pageNumber === currentPage || (isDouble && a.pageNumber === currentPage + 1)
  );
  const leftPageAnnotations = annotations.filter((a) => a.pageNumber === currentPage);
  const rightPageAnnotations = isDouble ? annotations.filter((a) => a.pageNumber === currentPage + 1) : [];
  const step = isDouble ? 2 : 1;

  // Pages that have annotations (for orange dot indicator)
  const pagesWithAnnotations = new Set(annotations.map((a) => a.pageNumber));

  // Assign each annotation a color index based on its position within its page
  const annColorIndex = buildAnnotationColorIndex(annotations);

  const tools: { mode: ToolMode; icon: any; label: string; disabled?: boolean }[] = [
    { mode: 'view', icon: MousePointer2, label: '浏览' },
    { mode: 'note', icon: StickyNote, label: '批注' },
    { mode: 'highlight', icon: Highlighter, label: '高亮', disabled: true },
    { mode: 'crop', icon: Scissors, label: '裁剪' },
  ];

  const toolsBefore: { mode: ToolMode; icon: any; label: string; disabled?: boolean }[] = [
    { mode: 'view', icon: MousePointer2, label: '浏览' },
  ];

  const toolsAfter: { mode: ToolMode; icon: any; label: string; disabled?: boolean }[] = [
    { mode: 'note', icon: StickyNote, label: '批注' },
    { mode: 'highlight', icon: Highlighter, label: '高亮', disabled: true },
    { mode: 'crop', icon: Scissors, label: '裁剪' },
  ];

  return (
    <div className="h-full flex flex-col bg-[#525659]">
      {/* Top bar - 3 column grid: left / center / right */}
      <header className="bg-[#323639] text-white px-2 py-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 flex-shrink-0 select-none">
        {/* === LEFT: back + sidebar toggle + title === */}
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0"
            title="返回"
          >
            <ArrowLeft size={18} />
          </button>
          {!leftOpen && (
            <button
              onClick={() => setLeftOpen(true)}
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0"
              title="目录"
            >
              <PanelLeft size={18} />
            </button>
          )}
          <h1 className="text-sm text-gray-200 truncate" title={currentBook.title}>{currentBook.title}</h1>
        </div>

        {/* === CENTER: page navigation === */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setCurrentPage(1)}
            disabled={currentPage <= 1}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
            title="第一页"
          >
            <ChevronFirst size={18} />
          </button>
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - step))}
            disabled={currentPage <= 1}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
            title="上一页"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-1 text-sm">
            <input
              type="number"
              value={currentPage}
              min={1}
              max={totalPages}
              onChange={(e) => {
                const p = Number(e.target.value);
                if (p >= 1 && p <= totalPages) setCurrentPage(p);
              }}
              className="w-12 bg-white/10 text-center rounded px-1 py-1 text-white border border-white/10 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            {isDouble && currentPage < totalPages && (
              <span className="text-gray-400">-{Math.min(currentPage + 1, totalPages)}</span>
            )}
            <span className="text-gray-400">/ {totalPages}</span>
            {showAnnotations && layers.annotations && pagesWithAnnotations.has(currentPage) && (
              <span className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-orange-400" title="本页有批注" />
            )}
          </div>
          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + step))}
            disabled={currentPage >= totalPages}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
            title="下一页"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage >= totalPages}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition"
            title="最后一页"
          >
            <ChevronLast size={18} />
          </button>
        </div>

        {/* === RIGHT: tools / zoom / layers / layout / more === */}
        <div className="flex items-center justify-end gap-0.5">
          {/* Group 1: Tool buttons */}
          {toolsBefore.map(({ mode, icon: Icon, label, disabled }) => (
            <button
              key={mode}
              onClick={() => !disabled && setTool(mode)}
              data-tooltip={label}
              className={`relative p-1.5 rounded transition flex-shrink-0 ${
                disabled
                  ? 'text-gray-600 opacity-40 cursor-not-allowed'
                  : tool === mode
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon size={16} />
            </button>
          ))}
          <button
            onClick={() => { setAssignmentMode(true); setRightTab('assignments'); }}
            data-tooltip="做题"
            className="relative p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0"
          >
            <PenLine size={16} />
          </button>
          {toolsAfter.map(({ mode, icon: Icon, label, disabled }) => (
            <button
              key={mode}
              onClick={() => !disabled && setTool(mode)}
              data-tooltip={label}
              className={`relative p-1.5 rounded transition flex-shrink-0 ${
                disabled
                  ? 'text-gray-600 opacity-40 cursor-not-allowed'
                  : tool === mode
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon size={16} />
            </button>
          ))}

          <div className="w-px h-5 bg-white/10 mx-0.5" />

          {/* Group 2: Zoom controls */}
          <button onClick={zoomOut} data-tooltip="缩小" className="relative p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0">
            <ZoomOut size={16} />
          </button>
          {editingZoom ? (
            <input
              type="text"
              value={zoomInput}
              onChange={(e) => setZoomInput(e.target.value)}
              onBlur={commitZoom}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitZoom();
                if (e.key === 'Escape') setEditingZoom(false);
              }}
              autoFocus
              className="w-12 text-center text-xs bg-white/10 text-white rounded py-0.5 px-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          ) : (
            <button
              onClick={startEditZoom}
              data-tooltip="点击输入缩放比例"
              className="relative text-xs w-12 text-center text-gray-300 hover:text-white py-0.5 rounded flex-shrink-0"
            >
              {Math.round(snapZoom(zoom) * 100)}%
            </button>
          )}
          <button onClick={zoomIn} data-tooltip="放大" className="relative p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0">
            <ZoomIn size={16} />
          </button>
          <button
            onClick={() => setFitMode('page')}
            data-tooltip="适应页面"
            className={`relative p-1.5 rounded transition flex-shrink-0 ${fitMode === 'page' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <Minimize2 size={16} />
          </button>
          <button
            onClick={() => setFitMode('width')}
            data-tooltip="适应宽度"
            className={`relative p-1.5 rounded transition flex-shrink-0 ${fitMode === 'width' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <Maximize2 size={16} />
          </button>

          <div className="w-px h-5 bg-white/10 mx-0.5" />

          {/* Group 3: Layers + layout */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setLayerDropdownOpen(!layerDropdownOpen)}
              data-tooltip="图层控制"
              className={`relative p-1.5 rounded transition flex items-center gap-0.5 ${
                Object.values(layers).some(v => !v)
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Layers size={16} />
            </button>
            {layerDropdownOpen && (
              <>
                <div className="fixed inset-0 z-50" onClick={() => setLayerDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-[#323639] border border-white/10 rounded-lg shadow-xl py-1 w-36">
                  {[
                    { key: 'annotations' as const, label: '批注图层' },
                    { key: 'highlights' as const, label: '高亮图层' },
                    { key: 'assignments' as const, label: '做题图层' },
                    { key: 'grading' as const, label: '批改图层' },
                  ].map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer text-sm text-gray-200"
                    >
                      <input
                        type="checkbox"
                        checked={layers[key]}
                        onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })}
                        className="accent-blue-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setPageLayout('single')}
            data-tooltip="单页"
            className={`relative p-1.5 rounded transition flex-shrink-0 ${pageLayout === 'single' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <Book size={16} />
          </button>
          <button
            onClick={() => setPageLayout('double')}
            data-tooltip="双页"
            className={`relative p-1.5 rounded transition flex-shrink-0 ${pageLayout === 'double' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <BookOpen size={16} />
          </button>

          <div className="w-px h-5 bg-white/10 mx-0.5" />

          {/* Group 4: More menu (rotate, download, DPI) */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              data-tooltip="更多"
              className="relative p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition flex items-center"
            >
              <MoreVertical size={16} />
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-50" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-[#323639] border border-white/10 rounded-lg shadow-xl py-1 w-44">
                  <button
                    onClick={() => { setRotation((r: number) => r - 90); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-200 hover:bg-white/5 transition"
                  >
                    <RotateCcw size={14} /> 逆时针旋转 90°
                  </button>
                  <a
                    href={currentBook.pdfUrl || undefined}
                    download={currentBook.pdfFileName || undefined}
                    aria-disabled={!currentBook.pdfUrl}
                    onClick={(event) => {
                      if (!currentBook.pdfUrl) event.preventDefault();
                      setMoreOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition ${
                      currentBook.pdfUrl ? 'text-gray-200 hover:bg-white/5' : 'text-gray-600 cursor-not-allowed'
                    }`}
                  >
                    <Download size={14} /> {currentBook.pdfFileName ? '下载原PDF' : '暂无 PDF'}
                  </a>
                  {availableDpis.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-gray-200">
                      <span className="text-xs text-gray-400">DPI</span>
                      <select
                        value={activeDpi}
                        onChange={(e) => { setSelectedDpi(Number(e.target.value)); setFitMode('page'); }}
                        className="flex-1 bg-transparent text-gray-200 text-xs rounded px-1 py-0.5 focus:outline-none cursor-pointer [&>option]:text-black"
                      >
                        {availableDpis.map(d => (
                          <option key={d} value={d}>{d} DPI</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Right sidebar toggle - shown when sidebar is closed */}
          {!rightOpen && (
            <button
              onClick={() => setRightOpen(true)}
              data-tooltip="批注 / 错题 / 作业"
              className="relative p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0"
            >
              <PanelRight size={18} />
            </button>
          )}
        </div>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - TOC */}
        {leftOpen && (
          <aside className="w-60 bg-[#323639] text-white flex flex-col flex-shrink-0 border-r border-black/20">
            <TocTree
              toc={currentBook.tocJson || []}
              currentPage={currentPage}
              totalPages={totalPages}
              storagePath={currentBook.storagePath || ''}
              onPageSelect={setCurrentPage}
              onClose={() => setLeftOpen(false)}
            />
          </aside>
        )}

        {/* Center - page image + annotation side panels */}
        <main ref={mainRef} className="flex-1 overflow-auto">
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="relative flex items-center justify-center gap-2" id="annotation-container">
              {/* Left annotation panel (double page mode: left page annotations) */}
              {showAnnotations && layers.annotations && isDouble && tool === 'view' && leftPageAnnotations.length > 0 && (
                <AnnotationSidePanel
                  annotations={leftPageAnnotations}
                  colorIndex={annColorIndex}
                  selectedAnnotationId={selectedAnnotationId}
                  onSelect={setSelectedAnnotationId}
                  side="left"
                  isDouble={isDouble}
                  currentPage={currentPage}
                  onNavigate={(p) => { setTool('view'); setShowAnnotations(true); skipClearRef.current = true; setCurrentPage(p); }}
                />
              )}

              <div
                className="flex items-center justify-center"
                style={{
                  width: effectiveRotation === 90 || effectiveRotation === 270
                    ? `${imgNatural.h * zoom * (isDouble ? 2 : 1) + (isDouble ? 4 : 0)}px`
                    : `${imgNatural.w * zoom * (isDouble ? 2 : 1) + (isDouble ? 4 : 0)}px`,
                  height: effectiveRotation === 90 || effectiveRotation === 270
                    ? `${imgNatural.w * zoom}px`
                    : `${imgNatural.h * zoom}px`,
                  minWidth: imgNatural.w > 0 ? undefined : '100%',
                  minHeight: imgNatural.h > 0 ? undefined : '100%',
                }}
              >
                <div
                  className="flex gap-1"
                  style={{
                    transform: `rotate(${rotation}deg)`,
                    transition: 'transform 0.2s ease',
                    transformOrigin: 'center center',
                  }}
                >
                  {tool === 'crop' ? (
                    <CropTool
                      storagePath={effectiveStoragePath}
                      pageNumber={currentPage}
                      zoom={zoom}
                      onSave={handleCropSave}
                      onCancel={() => setTool('view')}
                    />
                  ) : isDouble ? (
                    <>
                      <PageCanvas
                        storagePath={effectiveStoragePath}
                        pageNumber={currentPage}
                        zoom={zoom}
                        tool={tool}
                        annotations={annotations}
                        showAnnotations={showAnnotations && layers.annotations}
                        colorIndex={annColorIndex}
                        selectedAnnotationId={selectedAnnotationId}
                        onAnnotationClick={setSelectedAnnotationId}
                        onSaveAnnotation={handleSaveAnnotation}
                      />
                      <PageCanvas
                        storagePath={effectiveStoragePath}
                        pageNumber={currentPage + 1}
                        zoom={zoom}
                        tool={'view'}
                        annotations={annotations}
                        showAnnotations={showAnnotations && layers.annotations}
                        colorIndex={annColorIndex}
                        selectedAnnotationId={selectedAnnotationId}
                        onAnnotationClick={setSelectedAnnotationId}
                        onSaveAnnotation={handleSaveAnnotation}
                      />
                    </>
                  ) : (
                    <PageCanvas
                      storagePath={effectiveStoragePath}
                      pageNumber={currentPage}
                      zoom={zoom}
                      tool={tool}
                      annotations={annotations}
                      showAnnotations={showAnnotations && layers.annotations}
                      colorIndex={annColorIndex}
                      selectedAnnotationId={selectedAnnotationId}
                      onAnnotationClick={setSelectedAnnotationId}
                      onSaveAnnotation={handleSaveAnnotation}
                    />
                  )}
                </div>
              </div>

              {/* Right annotation panel (single page: all page annotations; double page: right page annotations) */}
              {showAnnotations && tool === 'view' && (isDouble ? rightPageAnnotations : leftPageAnnotations).length > 0 && (
                <AnnotationSidePanel
                  annotations={isDouble ? rightPageAnnotations : leftPageAnnotations}
                  colorIndex={annColorIndex}
                  selectedAnnotationId={selectedAnnotationId}
                  onSelect={setSelectedAnnotationId}
                  side="right"
                  isDouble={isDouble}
                  currentPage={currentPage}
                  onNavigate={(p) => { setTool('view'); setShowAnnotations(true); skipClearRef.current = true; setCurrentPage(p); }}
                />
              )}

              {/* Dashed connector line between selected annotation marker and side panel card */}
              {selectedAnnotationId !== null && (() => {
                const selectedAnn = annotations.find(a => a.id === selectedAnnotationId);
                if (!selectedAnn) return null;
                const ci = annColorIndex.get(selectedAnn.id) ?? 0;
                const color = getAnnotationColor(ci);
                return (
                  <DashedConnector
                    key={selectedAnnotationId}
                    colorHex={color.hex}
                    annotation={selectedAnn}
                    isDouble={isDouble}
                    currentPage={currentPage}
                  />
                );
              })()}
            </div>
          </div>
        </main>

        {/* Right sidebar - annotations & mistakes */}
        {rightOpen && (
          <aside className="w-72 bg-white flex flex-col flex-shrink-0 border-l border-gray-200">
            <div className="flex items-center border-b border-gray-200">
              {/* Right sidebar toggle on left */}
              <button
                onClick={() => setRightOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition flex-shrink-0"
                title="收起"
              >
                <PanelRight size={16} />
              </button>
              <button
                onClick={() => setRightTab('annotations')}
                className={`flex-1 py-2.5 text-sm font-medium transition ${
                  rightTab === 'annotations' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                批注 ({annotations.length})
              </button>
              <button
                onClick={loadMistakes}
                className={`flex-1 py-2.5 text-sm font-medium transition ${
                  rightTab === 'mistakes' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                错题本
              </button>
              <button
                onClick={() => setRightTab('assignments')}
                className={`flex-1 py-2.5 text-sm font-medium transition ${
                  rightTab === 'assignments' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                作业
              </button>
            </div>

            <div className="flex-1 overflow-auto scrollbar-thin">
              {rightTab === 'mistakes' ? (
                <MistakeList
                  mistakes={mistakes}
                  filter={mistakeFilter}
                  onFilterChange={setMistakeFilter}
                  onToggle={handleMistakeToggle}
                  onDelete={handleMistakeDelete}
                  onRefresh={() => fetchMistakes(mistakeFilter ? { subject: mistakeFilter } : undefined)}
                />
              ) : rightTab === 'assignments' ? (
                <AssignmentList
                  bookId={bookId}
                  onSelect={(a) => { setCurrentAssignment(a); setAssignmentMode(true); }}
                  selectedId={currentAssignment?.id ?? null}
                  onRefresh={assignmentRefresh}
                />
              ) : (
                <AnnotationList
                  annotations={annotations}
                  colorIndex={annColorIndex}
                  currentPage={currentPage}
                  isDouble={isDouble}
                  selectedAnnotationId={selectedAnnotationId}
                  onSelect={setSelectedAnnotationId}
                  onNavigate={(p) => { setTool('view'); setShowAnnotations(true); skipClearRef.current = true; setCurrentPage(p); }}
                  onDelete={setDeleteAnnId}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Annotation delete confirmation modal */}
      {deleteAnnId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDeleteAnnId(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-5 w-80"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-gray-800 mb-2">确认删除批注</h3>
            <p className="text-sm text-gray-500 mb-4">删除后无法恢复，确定要删除这条批注吗？</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteAnnId(null)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  removeAnnotation(deleteAnnId);
                  setDeleteAnnId(null);
                  setSelectedAnnotationId(null);
                }}
                className="px-3 py-1.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment mode overlay */}
      {assignmentMode && currentAssignment && (
        <AssignmentMode
          bookId={bookId}
          totalPages={totalPages}
          storagePath={effectiveStoragePath}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          zoom={zoom}
          rotation={rotation}
          assignment={currentAssignment}
          onExit={() => setAssignmentMode(false)}
          onAssignmentUpdate={() => setAssignmentRefresh(v => v + 1)}
        />
      )}
    </div>
  );
}

function formatAnnotationTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `今天 ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  } catch {
    return '';
  }
}

function AnnotationList({
  annotations,
  colorIndex,
  currentPage,
  isDouble,
  selectedAnnotationId,
  onSelect,
  onNavigate,
  onDelete,
}: {
  annotations: any[];
  colorIndex: Map<number, number>;
  currentPage: number;
  isDouble: boolean;
  selectedAnnotationId: number | null;
  onSelect: (id: number | null) => void;
  onNavigate: (page: number) => void;
  onDelete: (id: number) => void;
}) {
  if (annotations.length === 0) {
    return <div className="p-4 text-center text-gray-400 text-sm">暂无批注</div>;
  }
  return (
    <div className="p-2 space-y-2">
      {annotations.map((ann) => {
        const isCurrent = ann.pageNumber === currentPage || (isDouble && ann.pageNumber === currentPage + 1);
        const isSelected = selectedAnnotationId === ann.id;
        const ci = colorIndex.get(ann.id) ?? 0;
        const color = getAnnotationColor(ci);
        return (
          <div
            key={ann.id}
            className={`rounded-lg p-3 flex items-start gap-2 group cursor-pointer transition border-l-4 ${
              isSelected
                ? `${color.bg} ${color.border} ring-2 ring-offset-1`
                : isCurrent
                  ? 'bg-blue-50 border-blue-200'
                  : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
            }`}
            onClick={() => {
              if (isSelected) { onSelect(null); return; }
              onSelect(ann.id);
              // Only navigate if the annotation's page is NOT already visible
              // In double-page mode, currentPage and currentPage+1 are both visible
              const isAlreadyVisible = isDouble
                ? (ann.pageNumber === currentPage || ann.pageNumber === currentPage + 1)
                : (ann.pageNumber === currentPage);
              if (!isAlreadyVisible) {
                onNavigate(ann.pageNumber);
              }
            }}
          >
            <div className="flex-shrink-0 mt-0.5 flex items-center gap-1">
              {ann.type === 'note' && <StickyNote size={16} className="text-amber-500" />}
              {ann.type === 'highlight' && <Highlighter size={16} className="text-yellow-500" />}
              {ann.type === 'crop' && <Scissors size={16} className="text-blue-500" />}
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${color.dot}`}
                title={`批注 ${ci + 1}`}
              >
                {ci + 1}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              {ann.type === 'note' && (
                <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">{ann.contentJson.text}</p>
              )}
              {ann.type === 'highlight' && <span className="text-xs text-gray-500">高亮区域</span>}
              {ann.type === 'crop' && <span className="text-xs text-blue-500">错题裁剪</span>}
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs px-1.5 py-0.5 rounded ${isCurrent ? 'bg-blue-100 text-blue-600' : 'text-gray-400'}`}>
                  第 {ann.pageNumber} 页
                </span>
                {ann.createdAt && (
                  <span className="text-xs text-gray-400">{formatAnnotationTime(ann.createdAt)}</span>
                )}
                {ann.tags && <span className="text-xs text-gray-400 truncate">{ann.tags}</span>}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(ann.id); }}
              className="text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 flex-shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Side annotation panel rendered beside the page canvas */
function AnnotationSidePanel({
  annotations,
  colorIndex,
  selectedAnnotationId,
  onSelect,
  side,
  isDouble,
  currentPage,
  onNavigate,
}: {
  annotations: any[];
  colorIndex: Map<number, number>;
  selectedAnnotationId: number | null;
  onSelect: (id: number | null) => void;
  side: 'left' | 'right';
  isDouble: boolean;
  currentPage: number;
  onNavigate: (page: number) => void;
}) {
  return (
    <div className={`flex-shrink-0 w-56 max-h-full overflow-auto scrollbar-thin ${side === 'left' ? 'order-first' : 'order-last'}`}>
      <div className="space-y-2">
        {annotations.map((ann) => {
          const ci = colorIndex.get(ann.id) ?? 0;
          const color = getAnnotationColor(ci);
          const isSelected = selectedAnnotationId === ann.id;
          return (
            <div
              key={ann.id}
              data-annotation-id={ann.id}
              onClick={() => {
                if (isSelected) { onSelect(null); return; }
                onSelect(ann.id);
                if (ann.pageNumber !== undefined) {
                  // Only navigate if page not already visible
                  const isAlreadyVisible = isDouble
                    ? (ann.pageNumber === currentPage || ann.pageNumber === currentPage + 1)
                    : (ann.pageNumber === currentPage);
                  if (!isAlreadyVisible) {
                    onNavigate(ann.pageNumber);
                  }
                }
              }}
              className={`rounded-lg border p-2.5 cursor-pointer transition shadow-sm ${
                isSelected
                  ? `${color.border} ${color.bg} ring-2 ring-offset-1 shadow-md`
                  : `${color.border} ${color.bg} hover:shadow-md`
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ${color.dot}`}
                  title={`批注 ${ci + 1}`}
                >
                  {ci + 1}
                </span>
                <span className={`text-xs font-medium ${color.text}`}>第 {ann.pageNumber} 页</span>
                {ann.createdAt && (
                  <span className="text-[10px] text-gray-400 ml-auto">{formatAnnotationTime(ann.createdAt)}</span>
                )}
              </div>
              {ann.type === 'note' && (
                <p className="text-xs text-gray-700 whitespace-pre-wrap break-words leading-relaxed">{ann.contentJson.text}</p>
              )}
              {ann.type === 'highlight' && <span className="text-xs text-gray-500">高亮区域</span>}
              {ann.type === 'crop' && <span className="text-xs text-blue-500">错题裁剪</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Draws a dashed connector line between the selected annotation's canvas marker
 *  and its corresponding side panel card. Uses an SVG overlay positioned
 *  absolutely over the annotation container. */
function DashedConnector({
  colorHex,
  annotation,
  isDouble,
  currentPage,
}: {
  colorHex: string;
  annotation: any;
  isDouble: boolean;
  currentPage: number;
}) {
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  useEffect(() => {
    const container = document.getElementById('annotation-container');
    if (!container) return;

    const c = annotation.contentJson;

    // Determine which canvas this annotation belongs to.
    // In double-page mode, left page = currentPage, right page = currentPage+1
    // Canvases appear in DOM order: left first, then right
    const canvases = Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[];
    let canvas: HTMLCanvasElement | null = null;
    if (canvases.length === 1) {
      canvas = canvases[0];
    } else if (canvases.length >= 2) {
      canvas = annotation.pageNumber === currentPage ? canvases[0] : canvases[1];
    }

    if (!canvas) return;

    const canvasRect = canvas.getBoundingClientRect();

    // Compute the marker position in screen coordinates
    // contentJson has relative coords (0-1), multiply by canvas dimensions
    let markerX: number;
    let markerY: number;
    if (annotation.type === 'note') {
      markerX = canvasRect.left + c.x * canvasRect.width;
      markerY = canvasRect.top + c.y * canvasRect.height;
    } else if (annotation.type === 'highlight' || annotation.type === 'crop') {
      // Use center of the rect
      markerX = canvasRect.left + (c.x + c.w / 2) * canvasRect.width;
      markerY = canvasRect.top + (c.y + c.h / 2) * canvasRect.height;
    } else {
      markerX = canvasRect.left + canvasRect.width / 2;
      markerY = canvasRect.top + canvasRect.height / 2;
    }

    // Find the selected card (has ring-2 class)
    const selectedCardEl = Array.from(container.querySelectorAll('[data-annotation-id]'))
      .find((el) => el.classList.contains('ring-2'));
    if (!selectedCardEl) return;
    const cardRect = selectedCardEl.getBoundingClientRect();

    const containerRect = container.getBoundingClientRect();

    // Determine if card is on the right or left of canvas
    const cardOnRight = cardRect.left > canvasRect.left;

    // Start point: the edge of the SELECTED CARD that faces the canvas
    // (right edge if card is on left, left edge if card is on right)
    // Y = card's vertical center
    const x1 = cardOnRight
      ? cardRect.left - containerRect.left
      : cardRect.right - containerRect.left;
    const y1 = cardRect.top + cardRect.height / 2 - containerRect.top;

    // End point: the MARKER CIRCLE position on the canvas
    const x2 = markerX - containerRect.left;
    const y2 = markerY - containerRect.top;

    setLine({ x1, y1, x2, y2 });
  }, [annotation, isDouble, currentPage]);

  if (!line) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-50"
      style={{ width: '100%', height: '100%' }}
    >
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        stroke={colorHex}
        strokeWidth={2}
        strokeDasharray="6 4"
        opacity={0.7}
      />
      <circle cx={line.x1} cy={line.y1} r={4} fill={colorHex} opacity={0.7} />
      <circle cx={line.x2} cy={line.y2} r={4} fill={colorHex} opacity={0.7} />
    </svg>
  );
}

function MistakeList({
  mistakes,
  filter,
  onFilterChange,
  onToggle,
  onDelete,
  onRefresh,
}: {
  mistakes: any[];
  filter: string;
  onFilterChange: (v: string) => void;
  onToggle: (id: number, status: number) => void;
  onDelete: (id: number) => void;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="p-2 border-b border-gray-100">
        <input
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onRefresh()}
          placeholder="按学科筛选..."
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>
      {mistakes.length === 0 ? (
        <div className="p-4 text-center text-gray-400 text-sm">暂无错题</div>
      ) : (
        <div className="p-2 space-y-2">
          {mistakes.map((m) => (
            <div key={m.id} className="bg-gray-50 rounded-lg p-2 flex gap-2 group">
              <div className="w-16 h-16 flex-shrink-0 rounded overflow-hidden bg-amber-50 border border-amber-100 flex items-center justify-center">
                {m.imagePath ? (
                  <img
                    src={m.imagePath}
                    alt="错题"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span className="text-xs text-amber-400">无图</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-700">{m.subject}</span>
                  {m.book && <span className="text-xs text-gray-400 truncate">{m.book.title}</span>}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">第 {m.pageNumber} 页</div>
                {m.tags && <div className="text-xs text-gray-500 mt-0.5 truncate">{m.tags}</div>}
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => onToggle(m.id, m.reviewStatus)}
                    className={`flex items-center gap-1 text-xs transition ${
                      m.reviewStatus === 1 ? 'text-primary' : 'text-gray-400 hover:text-primary'
                    }`}
                  >
                    {m.reviewStatus === 1 ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    {m.reviewStatus === 1 ? '已掌握' : '未复习'}
                  </button>
                  <button
                    onClick={() => onDelete(m.id)}
                    className="text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
