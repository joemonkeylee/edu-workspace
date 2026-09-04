import { useState } from 'react';
import type { TocNode } from '../types';
import { ChevronRight, ChevronDown, FileText, LayoutGrid, List } from 'lucide-react';

interface TocTreeProps {
  toc: TocNode[];
  currentPage: number;
  totalPages: number;
  storagePath: string;
  onPageSelect: (page: number) => void;
}

export default function TocTree({ toc, currentPage, totalPages, storagePath, onPageSelect }: TocTreeProps) {
  const [view, setView] = useState<'toc' | 'thumbs'>('toc');
  const visibleToc = filterVisibleToc(toc);

  function pageUrl(page: number) {
    const padded = String(page).padStart(4, '0');
    return `${storagePath}page-${padded}.png`;
  }

  return (
    <div className="h-full flex flex-col">
      {/* View tabs */}
      <div className="flex border-b border-black/20 flex-shrink-0">
        <button
          onClick={() => setView('toc')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition ${
            view === 'toc' ? 'text-white border-b-2 border-[#006064]' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <List size={14} />
          目录
        </button>
        <button
          onClick={() => setView('thumbs')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition ${
            view === 'thumbs' ? 'text-white border-b-2 border-[#006064]' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          <LayoutGrid size={14} />
          缩略图
        </button>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        {view === 'toc' ? (
          <div className="py-2">
            {visibleToc.map((node, i) => (
              <TocItem key={i} node={node} depth={0} currentPage={currentPage} onPageSelect={onPageSelect} />
            ))}
          </div>
        ) : (
          <div className="p-2 grid grid-cols-2 gap-2">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <div
                key={page}
                onClick={() => onPageSelect(page)}
                className={`cursor-pointer rounded overflow-hidden border-2 transition ${
                  currentPage === page ? 'border-[#006064]' : 'border-transparent hover:border-white/20'
                }`}
              >
                <img
                  src={pageUrl(page)}
                  alt={`第 ${page} 页`}
                  loading="lazy"
                  className="w-full h-auto block bg-white"
                />
                <div className={`text-[10px] text-center py-0.5 ${
                  currentPage === page ? 'text-white bg-[#006064]' : 'text-gray-500 bg-black/20'
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
        className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer text-sm transition ${
          isActive ? 'bg-[#006064]/30 text-white font-medium border-l-2 border-[#006064]' : 'text-gray-300 hover:bg-white/5 border-l-2 border-transparent'
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
        <span className="text-xs text-gray-500 flex-shrink-0">{node.page}</span>
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
