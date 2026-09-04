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
  Trash2,
  CheckCircle2,
  Circle,
  RotateCcw,
  Layers,
} from 'lucide-react';

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

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'annotations' | 'mistakes'>('annotations');
  const [mistakeFilter, setMistakeFilter] = useState('');

  const [fitMode, setFitMode] = useState<FitMode>('page');
  const [pageLayout, setPageLayout] = useState<PageLayout>('single');
  const [rotation, setRotation] = useState(0); // degrees, negative = CCW
  const effectiveRotation = ((rotation % 360) + 360) % 360; // normalize to 0-359
  const mainRef = useRef<HTMLDivElement>(null);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });
  const [selectedDpi, setSelectedDpi] = useState<number>(0);

  useEffect(() => {
    if (bookId) {
      fetchBook(bookId);
      fetchAnnotations(bookId);
    }
    return () => clearCurrent();
  }, [bookId]);

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
  const tools: { mode: ToolMode; icon: any; label: string }[] = [
    { mode: 'view', icon: MousePointer2, label: '浏览' },
    { mode: 'note', icon: StickyNote, label: '笔记' },
    { mode: 'highlight', icon: Highlighter, label: '高亮' },
    { mode: 'crop', icon: Scissors, label: '裁剪' },
  ];

  return (
    <div className="h-full flex flex-col bg-[#525659]">
      {/* Top bar */}
      <header className="bg-[#323639] text-white px-2 py-1.5 flex items-center gap-0.5 flex-shrink-0 select-none relative">
        {/* Left: sidebar toggle + back + title */}
        <button
          onClick={() => setLeftOpen(!leftOpen)}
          className={`p-1.5 rounded transition ${leftOpen ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          title="目录"
        >
          <PanelLeft size={18} />
        </button>
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
          title="返回"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm text-gray-200 truncate max-w-xs" title={currentBook.title}>{currentBook.title}</h1>

        {/* Center: page number (Chrome-style) */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 text-sm">
          <input
            type="number"
            value={currentPage}
            min={1}
            max={totalPages}
            onChange={(e) => {
              const p = Number(e.target.value);
              if (p >= 1 && p <= totalPages) setCurrentPage(p);
            }}
            className="w-12 bg-white/10 text-center rounded px-1 py-1 text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {isDouble && currentPage < totalPages && (
            <span className="text-gray-400">-{Math.min(currentPage + 1, totalPages)}</span>
          )}
          <span className="text-gray-400">/ {totalPages}</span>
        </div>

        <div className="flex-1" />

        {/* Right controls */}
        {/* Tool buttons (icon-only) */}
        <div className="flex items-center gap-0.5">
          {tools.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setTool(mode)}
              title={label}
              className={`p-1.5 rounded transition ${
                tool === mode ? 'bg-[#006064] text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* Fit mode toggles */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setFitMode('page')}
            title="适应页面"
            className={`p-1.5 rounded transition ${fitMode === 'page' ? 'bg-[#006064] text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <Minimize2 size={16} />
          </button>
          <button
            onClick={() => setFitMode('width')}
            title="适应宽度"
            className={`p-1.5 rounded transition ${fitMode === 'width' ? 'bg-[#006064] text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <Maximize2 size={16} />
          </button>
        </div>

        {/* Rotate button */}
        <button
          onClick={() => setRotation((r) => r - 90)}
          className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition"
          title="逆时针旋转 90°"
        >
          <RotateCcw size={16} />
        </button>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5">
          <button onClick={zoomOut} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition" title="缩小">
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
              className="w-12 text-center text-xs bg-white/10 text-white rounded py-0.5 px-1 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <button
              onClick={startEditZoom}
              className="text-xs w-12 text-center text-gray-300 hover:text-white py-0.5 rounded"
              title="点击输入缩放比例"
            >
              {Math.round(snapZoom(zoom) * 100)}%
            </button>
          )}
          <button onClick={zoomIn} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition" title="放大">
            <ZoomIn size={16} />
          </button>
        </div>

        <div className="w-px h-5 bg-white/10 mx-0.5" />

        {/* Page layout toggles */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setPageLayout('single')}
            title="单页"
            className={`p-1.5 rounded transition ${pageLayout === 'single' ? 'bg-[#006064] text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <Book size={16} />
          </button>
          <button
            onClick={() => setPageLayout('double')}
            title="双页"
            className={`p-1.5 rounded transition ${pageLayout === 'double' ? 'bg-[#006064] text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <BookOpen size={16} />
          </button>
        </div>

        {/* DPI selector */}
        {availableDpis.length > 0 && (
          <div className="flex items-center gap-1">
            <Layers size={14} className="text-gray-500" />
            <select
              value={activeDpi}
              onChange={(e) => { setSelectedDpi(Number(e.target.value)); setFitMode('page'); }}
              className="bg-transparent text-gray-300 text-xs rounded px-1 py-1 focus:outline-none cursor-pointer [&>option]:text-black hover:text-white transition"
              title="选择分辨率"
            >
              {availableDpis.map(d => (
                <option key={d} value={d}>{d} DPI</option>
              ))}
            </select>
          </div>
        )}

        {/* Right sidebar toggle */}
        <button
          onClick={() => setRightOpen(!rightOpen)}
          className={`p-1.5 rounded transition ${rightOpen ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          title="批注 / 错题"
        >
          <PanelRight size={18} />
        </button>
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
            />
          </aside>
        )}

        {/* Center - page image */}
        <main ref={mainRef} className="flex-1 overflow-auto">
          <div className="min-h-full flex items-center justify-center p-4">
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
                  onSaveAnnotation={handleSaveAnnotation}
                />
                <PageCanvas
                  storagePath={effectiveStoragePath}
                  pageNumber={currentPage + 1}
                  zoom={zoom}
                  tool={'view'}
                  annotations={annotations}
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
                onSaveAnnotation={handleSaveAnnotation}
              />
            )}
              </div>{/* inner rotate div */}
            </div>{/* outer rotation wrapper */}
          </div>
        </main>

        {/* Right sidebar - annotations & mistakes */}
        {rightOpen && (
          <aside className="w-72 bg-white flex flex-col flex-shrink-0 border-l border-gray-200">
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setRightTab('annotations')}
                className={`flex-1 py-2.5 text-sm font-medium transition ${
                  rightTab === 'annotations' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                批注 ({pageAnnotations.length})
              </button>
              <button
                onClick={loadMistakes}
                className={`flex-1 py-2.5 text-sm font-medium transition ${
                  rightTab === 'mistakes' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                错题本
              </button>
            </div>

            <div className="flex-1 overflow-auto scrollbar-thin">
              {rightTab === 'annotations' ? (
                <AnnotationList
                  annotations={pageAnnotations}
                  onDelete={removeAnnotation}
                />
              ) : (
                <MistakeList
                  mistakes={mistakes}
                  filter={mistakeFilter}
                  onFilterChange={setMistakeFilter}
                  onToggle={handleMistakeToggle}
                  onDelete={handleMistakeDelete}
                  onRefresh={() => fetchMistakes(mistakeFilter ? { subject: mistakeFilter } : undefined)}
                />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function AnnotationList({ annotations, onDelete }: { annotations: any[]; onDelete: (id: number) => void }) {
  if (annotations.length === 0) {
    return <div className="p-4 text-center text-gray-400 text-sm">本页暂无批注</div>;
  }
  return (
    <div className="p-2 space-y-2">
      {annotations.map((ann) => (
        <div key={ann.id} className="bg-gray-50 rounded-lg p-3 flex items-start gap-2 group">
          <div className="flex-shrink-0 mt-0.5">
            {ann.type === 'note' && <StickyNote size={16} className="text-amber-500" />}
            {ann.type === 'highlight' && <Highlighter size={16} className="text-yellow-500" />}
            {ann.type === 'crop' && <Scissors size={16} className="text-blue-500" />}
          </div>
          <div className="flex-1 min-w-0">
            {ann.type === 'note' && (
              <p className="text-sm text-gray-700 break-words">{ann.contentJson.text}</p>
            )}
            {ann.type === 'highlight' && <span className="text-xs text-gray-500">高亮区域</span>}
            {ann.type === 'crop' && <span className="text-xs text-blue-500">错题裁剪</span>}
            {ann.tags && <span className="text-xs text-gray-400 block mt-1">{ann.tags}</span>}
          </div>
          <button
            onClick={() => onDelete(ann.id)}
            className="text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
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
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
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
                      m.reviewStatus === 1 ? 'text-green-600' : 'text-gray-400 hover:text-green-600'
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
