import { useMemo, useState } from 'react';
import {
  FileText, BookOpen, RefreshCw, Send, Trash2, ExternalLink, Clock, Layers, PenLine, X,
} from 'lucide-react';
import BookCover from '../BookCover';
import PdfBookCover from '../../pdf/components/PdfBookCover';
import { formatAssignmentTitle } from '../../utils/assignment';

/**
 * 概览页「我的提交」的半栏。
 *
 * 书籍作业（图片模式）与 PDF 作业（PDF 原生模式）是两套互不相干的表，
 * 但行结构、状态机、交互完全一致，所以这里用一个组件按 kind 分栏渲染：
 * 左栏 kind=book 跳 /book/:id，右栏 kind=pdf 跳 /pdf/book/:id。
 */

export type SubKind = 'book' | 'pdf';

export type SubRow = {
  kind: SubKind;
  id: number;
  bookId: number;
  title: string;
  status: string;
  updatedAt: string;
  pages?: number[] | null;
  bookTitle: string;
  bookSubject: string;
  /** 原始 book 对象，直接交给对应封面组件 */
  book: any;
};

export type SubCounts = { all: number; draft: number; submitted: number; graded: number; returned: number };
export type SubBookOption = { id: number; title: string; subject: string; count: number };

type TabKey = 'all' | 'draft' | 'returned' | 'submitted' | 'graded';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'returned', label: '已打回' },
  { key: 'submitted', label: '已提交' },
  { key: 'graded', label: '已批改' },
];

const STATUS_META: Record<string, { label: string; badge: string }> = {
  draft: { label: '草稿', badge: 'bg-muted text-muted-foreground' },
  returned: { label: '已打回', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  submitted: { label: '已提交', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  graded: { label: '已批改', badge: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' },
};

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  // 更早的一律带年份，避免跨年后分不清「9/25」是哪一年
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** 页码摘要：单页显示「第 N 页」，多页列出前三个并带总数 */
function formatPages(pages: number[] | null | undefined) {
  if (!pages || pages.length === 0) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  if (sorted.length === 1) return `第 ${sorted[0]} 页`;
  if (sorted.length <= 3) return `第 ${sorted.join('、')} 页`;
  return `第 ${sorted.slice(0, 3).join('、')} 等 ${sorted.length} 页`;
}

interface Props {
  kind: SubKind;
  rows: SubRow[];
  counts: SubCounts;
  loading: boolean;
  books: SubBookOption[];
  selectedBook: string;
  onSelectBook: (v: string) => void;
  onRefresh: () => void;
  onOpen: (row: SubRow) => void;
  onSubmit: (row: SubRow) => void;
  onDelete: (row: SubRow) => void;
  /** 正在提交/删除的作业 id，避免连点 */
  busyId: number | null;
}

export default function SubmissionPane({
  kind, rows, counts, loading, books, selectedBook, onSelectBook,
  onRefresh, onOpen, onSubmit, onDelete, busyId,
}: Props) {
  const [tab, setTab] = useState<TabKey>('all');

  const tabCount = (key: TabKey) => (key === 'all' ? counts.all : counts[key as keyof SubCounts] || 0);

  const filtered = useMemo(
    () => (tab === 'all' ? rows : rows.filter((r) => r.status === tab)),
    [rows, tab]
  );

  const isPdf = kind === 'pdf';
  const Icon = isPdf ? FileText : BookOpen;
  const heading = isPdf ? '我的提交 · PDF' : '我的提交 · 书籍';

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <Icon size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">{heading}</span>

        {books.length > 0 && (
          <div className="relative min-w-0 flex-1 sm:max-w-[180px]">
            <select
              value={selectedBook}
              onChange={(e) => onSelectBook(e.target.value)}
              className="w-full appearance-none truncate rounded-md border border-border bg-card py-0.5 pl-2 pr-6 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              title="按书本筛选"
            >
              <option value="">全部书本 ({books.length})</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} ({b.count})
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">▾</span>
            {selectedBook && (
              <button
                type="button"
                onClick={() => onSelectBook('')}
                className="absolute right-5 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/30 text-white transition hover:bg-muted-foreground/50"
                title="清除筛选"
              >
                <X size={9} strokeWidth={3} />
              </button>
            )}
          </div>
        )}

        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded px-1.5 py-0.5 text-[11px] transition ${
              tab === t.key
                ? 'bg-card font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            <span className="ml-0.5 tabular-nums opacity-60">{tabCount(t.key)}</span>
          </button>
        ))}

        <div className="flex-1" />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
          title="刷新"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div>
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-muted-foreground">
            <PenLine size={22} />
            <p className="px-4 text-center text-xs">
              {rows.length === 0
                ? isPdf
                  ? '还没有 PDF 作业，打开一本 PDF 进入「作业模式」开始作答'
                  : '还没有作业记录，打开一本书进入「作业模式」开始作答'
                : `没有${TABS.find((t) => t.key === tab)?.label}的作业`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((row) => {
              const meta = STATUS_META[row.status] || STATUS_META.draft;
              const canEdit = row.status === 'draft' || row.status === 'returned';
              const title = formatAssignmentTitle(row.title) || `作业 #${row.id}`;
              return (
                <div
                  key={row.id}
                  onClick={() => onOpen(row)}
                  className="group flex cursor-pointer items-center gap-2.5 px-3 py-2 transition hover:bg-muted"
                  title="点击打开这本书并定位到该作业"
                >
                  {/* 封面缩略图：容器按 A4 定比例，contain 保证整张可见 */}
                  <div
                    className="flex-shrink-0 overflow-hidden rounded ring-1 ring-border"
                    style={{ width: '26px', aspectRatio: '210 / 297' }}
                  >
                    {isPdf ? (
                      <PdfBookCover
                        book={row.book || { id: row.bookId, title: row.bookTitle }}
                        fit="contain"
                        className="h-full w-full"
                        width={120}
                      />
                    ) : (
                      <BookCover
                        book={row.book || { id: row.bookId, title: row.bookTitle }}
                        fit="contain"
                        className="h-full w-full"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-foreground">{title}</span>
                      <span className={`flex-shrink-0 rounded px-1 py-px text-[10px] ${meta.badge}`}>{meta.label}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate">{row.bookTitle}</span>
                        {row.bookSubject && (
                          <span className="flex-shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            {row.bookSubject}
                          </span>
                        )}
                      </span>
                      {formatPages(row.pages) && (
                        <span className="flex flex-shrink-0 items-center gap-0.5">
                          <Layers size={9} />
                          {formatPages(row.pages)}
                        </span>
                      )}
                      {/* 服务端在保存笔迹时会同步 updatedAt，所以它就是「最后一次动手时间」 */}
                      <span className="flex flex-shrink-0 items-center gap-0.5">
                        <Clock size={9} />
                        {formatTime(row.updatedAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-0.5">
                    {canEdit ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onSubmit(row); }}
                          disabled={busyId === row.id}
                          className="rounded p-1 text-muted-foreground/60 transition hover:bg-primary/10 hover:text-primary disabled:opacity-40"
                          title="提交作业"
                        >
                          <Send size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onDelete(row); }}
                          disabled={busyId === row.id}
                          className="rounded p-1 text-muted-foreground/60 transition hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
                          title="删除作业"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : (
                      <ExternalLink size={13} className="text-transparent transition group-hover:text-muted-foreground" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
