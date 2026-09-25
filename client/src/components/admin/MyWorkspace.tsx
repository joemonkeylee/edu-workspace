import { useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCw, Send, Trash2, ExternalLink, Clock, Layers, PenLine, X } from 'lucide-react';
import { getMyAssignments, updateAssignment, deleteAssignment, type Assignment } from '../../api/client';
import { toast } from 'sonner';
import { useConfirm } from '../ConfirmDialog';
import { formatAssignmentTitle } from '../../utils/assignment';
import { useAuthStore } from '../../store/authStore';
import BookCover from '../BookCover';

type Row = Assignment & {
  book: {
    id: number;
    title: string;
    subject: string;
    category: string;
    coverPage: number;
    totalPages: number;
    storagePath: string;
    availableDpis: number[];
  } | null;
};

type Counts = { all: number; draft: number; submitted: number; graded: number; returned: number };

type TabKey = 'all' | 'draft' | 'returned' | 'submitted' | 'graded';

type BookOption = { id: number; title: string; subject: string; count: number };

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

/**
 * admin 概览页的工作台，纵向两块：
 * 1. 「学习概览」4 个指标平铺一行。
 * 2. 「我的提交」整宽卡片 —— 草稿 / 已提交 / 已批改 / 已打回 全在一处，
 *    点任意一条直接跳到这本书的作业模式；列表自然高度，卡片内不滚动。
 * english 打卡墙等后续模块插在两块之间或继续往下追加新行即可。
 */
export default function MyWorkspace() {
  const confirm = useConfirm();
  const { user, authEnabled } = useAuthStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts>({ all: 0, draft: 0, submitted: 0, graded: 0, returned: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('all');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [selectedBook, setSelectedBook] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await getMyAssignments(80, selectedBook ? Number(selectedBook) : undefined);
      setRows(res.data);
      setCounts(res.counts);
      setBooks(res.books || []);
    } catch (e: any) {
      toast.error('加载作业失败: ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [selectedBook]);

  const tabCount = (key: TabKey) => (key === 'all' ? counts.all : counts[key as keyof Counts] || 0);

  const filtered = useMemo(
    () => (tab === 'all' ? rows : rows.filter((r) => r.status === tab)),
    [rows, tab]
  );

  /** 跳到这本书的作业模式。教师开批改层（grading=1），其余一律只读查看 */
  const open = (row: Row) => {
    const canGrade = !authEnabled || Boolean(user?.isAdmin || user?.roles?.includes('teacher'));
    const suffix = canGrade && row.status === 'submitted' ? '&grading=1' : '';
    window.open(`/book/${row.bookId}?assignmentId=${row.id}${suffix}`, '_blank');
  };

  const handleSubmit = async (e: React.MouseEvent, row: Row) => {
    e.stopPropagation();
    if (busyId) return;
    const title = formatAssignmentTitle(row.title) || `作业 #${row.id}`;
    const confirmed = await confirm({
      title: '确认提交',
      message: `确认提交作业「${title}」吗？\n提交后作业将变为只读，无法再修改或删除。`,
      confirmText: '确认提交',
      confirmClass: 'bg-blue-600 text-white hover:bg-blue-700',
    });
    if (!confirmed) return;
    setBusyId(row.id);
    try {
      await updateAssignment(row.id, { status: 'submitted' });
      toast.success('作业已提交');
      await load();
    } catch (err: any) {
      toast.error('提交失败: ' + (err?.message || ''));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, row: Row) => {
    e.stopPropagation();
    if (busyId) return;
    const title = formatAssignmentTitle(row.title) || `作业 #${row.id}`;
    const confirmed = await confirm({
      title: '确认删除',
      message: `确认删除作业「${title}」吗？此操作不可撤销。`,
      confirmText: '确认删除',
      confirmClass: 'bg-red-600 text-white hover:bg-red-700',
    });
    if (!confirmed) return;
    setBusyId(row.id);
    try {
      await deleteAssignment(row.id);
      toast.success('作业已删除');
      await load();
    } catch (err: any) {
      toast.error('删除失败: ' + (err?.message || ''));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ── 学习概览：4 个指标平铺一行；english 打卡墙等后续模块往中间插 ── */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
        {[
          { label: '草稿待提交', value: counts.draft, tone: 'text-foreground' },
          { label: '待批改', value: counts.submitted, tone: 'text-blue-600 dark:text-blue-300' },
          { label: '已批改', value: counts.graded, tone: 'text-green-600 dark:text-green-300' },
          { label: '已打回', value: counts.returned, tone: 'text-amber-600 dark:text-amber-300' },
        ].map((s) => (
          <div key={s.label} className="bg-card px-4 py-3">
            <div className={`text-xl font-semibold tabular-nums ${s.tone}`}>{s.value}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── 我的提交：整宽一块，列表自然高度，不在卡片内部滚动 ────── */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <FileText size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">我的提交</span>
          {books.length > 0 && (
            <div className="relative max-w-[220px] min-w-0 flex-1 sm:max-w-[260px]">
              <select
                value={selectedBook}
                onChange={(e) => setSelectedBook(e.target.value)}
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
                  onClick={() => setSelectedBook('')}
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
            onClick={load}
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
              <p className="text-xs">
                {rows.length === 0
                  ? '还没有作业记录，打开一本书进入「作业模式」开始作答'
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
                    onClick={() => open(row)}
                    className="group flex cursor-pointer items-center gap-2.5 px-3 py-2 transition hover:bg-muted"
                    title="点击打开这本书并定位到该作业"
                  >
                    {/* 封面缩略图：容器按 A4 定比例，contain 保证整张可见 */}
                    <div
                      className="flex-shrink-0 overflow-hidden rounded ring-1 ring-border"
                      style={{ width: '26px', aspectRatio: '210 / 297' }}
                    >
                      <BookCover
                        book={row.book || { id: row.bookId, title: `书籍 #${row.bookId}` }}
                        fit="contain"
                        className="h-full w-full"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-foreground">{title}</span>
                        <span className={`flex-shrink-0 rounded px-1 py-px text-[10px] ${meta.badge}`}>{meta.label}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="truncate">{row.book?.title || `书籍 #${row.bookId}`}</span>
                          {row.book?.subject && (
                            <span className="flex-shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              {row.book.subject}
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
                            onClick={(e) => handleSubmit(e, row)}
                            disabled={busyId === row.id}
                            className="rounded p-1 text-muted-foreground/60 transition hover:bg-primary/10 hover:text-primary disabled:opacity-40"
                            title="提交作业"
                          >
                            <Send size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, row)}
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
    </div>
  );
}
