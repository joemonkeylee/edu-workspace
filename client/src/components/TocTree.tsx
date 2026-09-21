import { useEffect, useRef, useState } from 'react';
import type { TocNode } from '../types';
import { ChevronRight, ChevronDown, FileText, LayoutGrid, List, Video } from 'lucide-react';
import VideoListPanel from './VideoListPanel';

type TocView = 'thumbs' | 'toc' | 'video';

interface TocTreeProps {
  toc: TocNode[];
  currentPage: number;
  totalPages: number;
  storagePath: string;
  onPageSelect: (page: number) => void;
  bookId: number;
  hasVideos: boolean;
  view: TocView;
  onViewChange: (v: TocView) => void;
}

export default function TocTree({
  toc,
  currentPage,
  totalPages,
  storagePath,
  onPageSelect,
  bookId,
  hasVideos,
  view,
  onViewChange,
}: TocTreeProps) {
  const visibleToc = filterVisibleToc(toc);
  const scrollRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  function pageUrl(page: number) {
    const padded = String(page).padStart(4, '0');
    return `${storagePath}page-${padded}.png`;
  }

  // Scroll active TOC item into view
  useEffect(() => {
    if (view !== 'toc' || !scrollRef.current) return;
    const active = scrollRef.current.querySelector('[data-active="true"]');
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentPage, view]);

  // Scroll active thumbnail into view
  useEffect(() => {
    if (view !== 'thumbs' || !thumbRef.current) return;
    const active = thumbRef.current.querySelector(`[data-page="${currentPage}"]`);
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentPage, view]);

  const tabClass = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition ${
      active ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="h-full flex flex-col">
      {/* View tabs + close button on one line */}
      <div className="flex items-center border-b border-border flex-shrink-0">
        <button onClick={() => onViewChange('thumbs')} className={tabClass(view === 'thumbs')}>
          <LayoutGrid size={14} />
          页码
        </button>
        <button onClick={() => onViewChange('toc')} className={tabClass(view === 'toc')}>
          <List size={14} />
          目录
        </button>
        {hasVideos && (
          <button onClick={() => onViewChange('video')} className={tabClass(view === 'video')}>
            <Video size={14} />
            视频
          </button>
        )}
      </div>

      <div className={`flex-1 overflow-auto scrollbar-thin ${view === 'video' ? 'flex flex-col' : ''}`} ref={scrollRef}>
        {view === 'video' ? (
          <VideoListPanel bookId={bookId} />
        ) : view === 'toc' ? (
          <div className="py-2">
            {visibleToc.map((node, i) => (
              <TocItem key={i} node={node} depth={0} currentPage={currentPage} onPageSelect={onPageSelect} />
            ))}
          </div>
        ) : (
          <div className="p-4 space-y-4" ref={thumbRef}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <div
                key={page}
                data-page={page}
                onClick={() => onPageSelect(page)}
                className={`cursor-pointer rounded overflow-hidden border-2 transition ${
                  currentPage === page ? 'border-primary' : 'border-transparent hover:border-border'
                }`}
              >
                <img
                  src={pageUrl(page)}
                  alt={`第 ${page} 页`}
                  loading="lazy"
                  className="w-full h-auto block bg-white"
                />
                <div className={`text-[10px] text-center py-0.5 ${
                  currentPage === page ? 'text-primary-foreground bg-primary' : 'text-muted-foreground bg-muted'
                }`}>
                  {page}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function filterVisibleToc(nodes: TocNode[]): TocNode[] {
  return nodes
    .filter((node) => !node.ignored)
    .map((node) => ({
      ...node,
      children: node.children ? filterVisibleToc(node.children) : undefined,
    }));
}

function TocItem({
  node,
  depth,
  currentPage,
  onPageSelect,
}: {
  node: TocNode;
  depth: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  const isActive = node.page === currentPage;

  return (
    <div>
      <div
        data-active={isActive}
        className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer text-sm transition ${
          isActive ? 'bg-primary/15 text-primary font-medium border-l-2 border-primary' : 'text-muted-foreground hover:bg-muted border-l-2 border-transparent'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8 - 2}px` }}
        onClick={() => {
          if (hasChildren && depth > 0) setExpanded(!expanded);
          onPageSelect(node.page);
        }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown size={14} className="flex-shrink-0" />
          ) : (
            <ChevronRight size={14} className="flex-shrink-0" />
          )
        ) : (
          <FileText size={14} className="flex-shrink-0 opacity-50" />
        )}
        <span className="truncate flex-1">{node.title}</span>
        <span className="text-xs text-muted-foreground flex-shrink-0">{node.page}</span>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children!.map((child, i) => (
            <TocItem
              key={i}
              node={child}
              depth={depth + 1}
              currentPage={currentPage}
              onPageSelect={onPageSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
