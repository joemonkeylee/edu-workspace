import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import * as api from '../api/client';
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
  PanelLeft,
  PanelRight,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Trash2,
  CheckCircle2,
  Circle,
} from 'lucide-react';

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

  useEffect(() => {
    if (bookId) {
      fetchBook(bookId);
      fetchAnnotations(bookId);
    }
    return () => clearCurrent();
  }, [bookId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (!currentBook) return;
      if (e.key === 'ArrowLeft' && currentPage > 1) setCurrentPage(currentPage - 1);
      if (e.key === 'ArrowRight' && currentPage < currentBook.totalPages) setCurrentPage(currentPage + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPage, currentBook, setCurrentPage]);

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
  const pageAnnotations = annotations.filter((a) => a.pageNumber === currentPage);
  const tools: { mode: ToolMode; icon: any; label: string }[] = [
    { mode: 'view', icon: MousePointer2, label: '浏览' },
    { mode: 'note', icon: StickyNote, label: '笔记' },
    { mode: 'highlight', icon: Highlighter, label: '高亮' },
    { mode: 'crop', icon: Scissors, label: '裁剪' },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* Top bar */}
      <header className="bg-sidebar text-white px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-gray-300 hover:text-white transition text-sm"
        >
          <ArrowLeft size={18} />
        </button>
        <button
          onClick={() => setLeftOpen(!leftOpen)}
          className={`p-1.5 rounded transition ${leftOpen ? 'bg-white/10' : 'hover:bg-white/10'}`}
        >
          <PanelLeft size={18} />
        </button>
        <h1 className="font-semibold text-sm truncate flex-1">{currentBook.title}</h1>

        {/* Tool buttons */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
          {tools.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setTool(mode)}
              title={label}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition ${
                tool === mode ? 'bg-primary text-white' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              <Icon size={16} />
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(zoom - 0.25)} className="p-1.5 rounded hover:bg-white/10 transition">
            <ZoomOut size={18} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="text-xs w-12 text-center text-gray-300 hover:text-white"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom(zoom + 0.25)} className="p-1.5 rounded hover:bg-white/10 transition">
            <ZoomIn size={18} />
          </button>
          <button onClick={() => setZoom(1)} title="适应宽度" className="p-1.5 rounded hover:bg-white/10 transition">
            <Maximize2 size={16} />
          </button>
        </div>

        <button
          onClick={() => setRightOpen(!rightOpen)}
          className={`p-1.5 rounded transition ${rightOpen ? 'bg-white/10' : 'hover:bg-white/10'}`}
        >
          <PanelRight size={18} />
        </button>
      </header>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - TOC */}
        {leftOpen && (
          <aside className="w-60 bg-sidebar text-white flex flex-col flex-shrink-0 border-r border-white/10">
            <div className="px-3 py-2 text-xs text-gray-400 border-b border-white/10">目录</div>
            <div className="flex-1 overflow-auto scrollbar-thin">
              <TocTree toc={currentBook.tocJson || []} currentPage={currentPage} onPageSelect={setCurrentPage} />
            </div>
          </aside>
        )}

        {/* Center - page image */}
        <main className="flex-1 overflow-auto flex flex-col items-center bg-gray-300/30">
          <div className="p-4 inline-block">
            {tool === 'crop' ? (
              <CropTool
                storagePath={currentBook.storagePath}
                pageNumber={currentPage}
                zoom={zoom}
                onSave={handleCropSave}
                onCancel={() => setTool('view')}
              />
            ) : (
              <PageCanvas
                storagePath={currentBook.storagePath}
                pageNumber={currentPage}
                zoom={zoom}
                tool={tool}
                annotations={annotations}
                onSaveAnnotation={handleSaveAnnotation}
              />
            )}
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

      {/* Bottom page navigation */}
      <footer className="bg-sidebar text-white px-4 py-2 flex items-center justify-center gap-4 flex-shrink-0">
        <button
          onClick={() => setCurrentPage(1)}
          disabled={currentPage <= 1}
          className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 transition"
        >
          <ChevronFirst size={18} />
        </button>
        <button
          onClick={() => setCurrentPage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 transition"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="number"
            value={currentPage}
            min={1}
            max={totalPages}
            onChange={(e) => {
              const p = Number(e.target.value);
              if (p >= 1 && p <= totalPages) setCurrentPage(p);
            }}
            className="w-12 bg-white/10 text-center rounded px-1 py-0.5 text-white border border-white/10 focus:outline-none focus:border-primary"
          />
          <span className="text-gray-400">/ {totalPages}</span>
        </div>
        <button
          onClick={() => setCurrentPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 transition"
        >
          <ChevronRight size={18} />
        </button>
        <button
          onClick={() => setCurrentPage(totalPages)}
          disabled={currentPage >= totalPages}
          className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 transition"
        >
          <ChevronLast size={18} />
        </button>
      </footer>
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
              <img src={m.imagePath} alt="错题" className="w-16 h-16 object-cover rounded flex-shrink-0" />
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
