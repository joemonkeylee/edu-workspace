import { useState } from 'react';
import type { TocNode } from '../types';
import { ChevronRight, ChevronDown, FileText } from 'lucide-react';

interface TocTreeProps {
  toc: TocNode[];
  currentPage: number;
  onPageSelect: (page: number) => void;
}

export default function TocTree({ toc, currentPage, onPageSelect }: TocTreeProps) {
  const visibleToc = filterVisibleToc(toc);

  return (
    <div className="py-2">
      {visibleToc.map((node, i) => (
        <TocItem key={i} node={node} depth={0} currentPage={currentPage} onPageSelect={onPageSelect} />
      ))}
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
        className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer rounded text-sm transition ${
          isActive ? 'bg-primary/20 text-blue-400 font-medium' : 'text-gray-300 hover:bg-white/5'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
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
