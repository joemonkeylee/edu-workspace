import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, List, Search, FileText, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { thumbUrl, searchInBook, type SearchHit } from '../api/pdfClient';

export type PdfTocView = 'thumbs' | 'toc' | 'search';

export interface PdfTocNode {
  title: string;
  page: number | null;
  ignored?: boolean;
  children?: PdfTocNode[];
}

interface Props {
  toc: PdfTocNode[];
  currentPage: number;
  totalPages: number;
  bookId: number;
  /** 是否可搜索（扫描件无文本层时隐藏「搜索」tab） */
  searchable: boolean;
  view: PdfTocView;
  onViewChange: (v: PdfTocView) => void;
  onPageSelect: (page: number) => void;
}

/**
 * PDF 阅读器的左侧栏：页码缩略图 / 目录 / 全文搜索。
 *
 * 与图片版 TocTree 的差异：第三个 tab 从「视频」换成「搜索」——
 * PDF 域没有视频关联，但有文本层，书内搜索反而是 PDF 模式相对图片模式的独有能力。
 * 缩略图走服务端的按需生成 + 落盘缓存接口。
 */
export default function PdfTocTree({
  toc, currentPage, totalPages, bookId, searchable, view, onViewChange, onPageSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  // 切换 tab 时跟随当前页滚动
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (view === 'toc') {
      const active = el.querySelector('[data-active="true"]');
      active?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (view === 'thumbs') {
      const target = el.querySelector(`[data-page="${currentPage}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentPage, view]);

  const runSearch = async () => {
    const text = q.trim();
    if (!text) { setHits([]); setSearchMsg(null); return; }
    setSearching(true);
    setSearchMsg(null);
    try {
      const res = await searchInBook(bookId, text, true);
      setHits(res.hits || []);
      if (!res.hits?.length) setSearchMsg(res.message || '没有找到匹配的内容');
    } catch (e: any) {
      setSearchMsg('搜索失败: ' + (e?.message || ''));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-sidebar-border">
        <button
          onClick={() => onViewChange('thumbs')}
          className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs transition ${
            view === 'thumbs' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <LayoutGrid size={13} /> 页码
        </button>
        <button
          onClick={() => onViewChange('toc')}
          className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs transition ${
            view === 'toc' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <List size={13} /> 目录
        </button>
        {searchable && (
          <button
            onClick={() => onViewChange('search')}
            className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs transition ${
              view === 'search' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Search size={13} /> 搜索
          </button>
        )}
      </div>

      {view === 'search' && (
        <div className="border-b border-sidebar-border p-2">
          <div className="flex gap-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
              placeholder="在本书中搜索…"
              className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={runSearch}
              disabled={searching || !q.trim()}
              className="flex items-center rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-40"
            >
              {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            </button>
          </div>
        </div>
      )}

      <div ref={containerRef} className="flex-1 overflow-auto scrollbar-thin p-4 space-y-4">
        {view === 'thumbs' && (
          <div className="space-y-3">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                data-page={page}
                onClick={() => onPageSelect(page)}
                className={`block w-full overflow-hidden rounded border transition ${
                  page === currentPage ? 'border-primary' : 'border-border hover:border-border'
                }`}
              >
                <img
                  src={thumbUrl(bookId, page, 160)}
                  alt={`第 ${page} 页`}
                  loading="lazy"
                  decoding="async"
                  className="block w-full"
                />
                <div
                  className={`py-0.5 text-center text-[10px] ${
                    page === currentPage ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {page}
                </div>
              </button>
            ))}
          </div>
        )}

        {view === 'toc' && (
          <div>
            {filterVisible(toc).length === 0 ? (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                这本书没有目录
              </div>
            ) : (
              filterVisible(toc).map((node, i) => (
                <TocItem
                  key={`${node.title}-${i}`}
                  node={node}
                  depth={0}
                  currentPage={currentPage}
                  onPageSelect={onPageSelect}
                />
              ))
            )}
          </div>
        )}

        {view === 'search' && (
          <div className="space-y-1">
            {searchMsg && <div className="px-1 py-2 text-xs text-muted-foreground">{searchMsg}</div>}
            {hits.map((h, i) => (
              <button
                key={`${h.pageNumber}-${i}`}
                onClick={() => onPageSelect(h.pageNumber)}
                className={`block w-full rounded border p-2 text-left text-xs transition ${
                  h.pageNumber === currentPage
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="font-medium text-foreground">第 {h.pageNumber} 页</span>
                </div>
                <div className="line-clamp-3 leading-relaxed text-muted-foreground">{h.snippet}</div>
              </button>
            ))}
            {!searchMsg && hits.length === 0 && (
              <div className="px-1 py-6 text-center text-xs text-muted-foreground">
                输入关键字后回车搜索
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function filterVisible(nodes: PdfTocNode[]): PdfTocNode[] {
  return (nodes || [])
    .filter((n) => !n.ignored)
    .map((n) => ({ ...n, children: n.children ? filterVisible(n.children) : undefined }));
}

function TocItem({
  node, depth, currentPage, onPageSelect,
}: {
  node: PdfTocNode;
  depth: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isActive = node.page != null && node.page === currentPage;

  return (
    <div>
      <button
        data-active={isActive}
        onClick={() => {
          if (hasChildren && depth > 0) setExpanded(!expanded);
          if (node.page != null) onPageSelect(node.page);
        }}
        className={`flex w-full items-center gap-1 rounded border-l-2 px-1 py-1 text-left text-sm transition ${
          isActive ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
        style={{ paddingLeft: depth * 12 + 8 - 2 }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={11} className="flex-shrink-0" /> : <ChevronRight size={11} className="flex-shrink-0" />
        ) : (
          <FileText size={11} className="flex-shrink-0 opacity-50" />
        )}
        <span className="flex-1 truncate">{node.title}</span>
        {node.page != null && <span className="flex-shrink-0 text-[10px] opacity-70">{node.page}</span>}
      </button>
      {expanded && hasChildren && (
        <div>
          {node.children!.map((child, i) => (
            <TocItem
              key={`${child.title}-${i}`}
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
